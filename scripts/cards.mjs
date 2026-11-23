#!/usr/bin/env node
// recall-cards 卡片索引/检索/复习调度/图谱工具（零依赖）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export const ROOT = process.env.RECALL_CARDS_HOME || path.join(os.homedir(), '.recall-cards');
export const CARDS_DIR = path.join(ROOT, 'cards');
const INDEX_FILE = path.join(ROOT, 'index.json');

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ensureDirs() {
  fs.mkdirSync(CARDS_DIR, { recursive: true });
}

// 纯文本清洗：去掉 Markdown 加粗/斜体/行内代码/标题记号，保留列表短横与标识符里的下划线
export function plain(s) {
  return String(s ?? '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// 文件夹（课程级容器，支持多级路径，用 / 分隔）：规范化每段、去空段，缺省归入"默认"
export function normalizeFolder(s) {
  const parts = String(s ?? '').split('/').map(x => x.trim()).filter(Boolean);
  return parts.length ? parts.join('/') : '默认';
}
export function folderOf(meta) {
  return normalizeFolder(meta.folder);
}
// 祖先路径（含自身），如 a/b/c → [a, a/b, a/b/c]
export function folderAncestors(p) {
  const parts = normalizeFolder(p).split('/');
  const out = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}
// folder 是否位于 prefix 之下（含自身），用于按文件夹子树作用域
export function isUnder(folder, prefix) {
  if (!prefix) return true;
  const f = normalizeFolder(folder), p = normalizeFolder(prefix);
  return f === p || f.startsWith(p + '/');
}
export function folderParent(p) {
  const parts = normalizeFolder(p).split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '默认';
}
// 大类：优先显式 category，否则回退到二级 tag / 一级 tag
export function categoryOf(meta) {
  const tags = meta.tags || [];
  return (meta.category && String(meta.category).trim()) || tags[1] || tags[0] || '未分类';
}
export function statusOf(meta) {
  return meta.status === 'draft' ? 'draft' : 'active';
}

// ---- frontmatter（受控 YAML 子集：标量 / 内联数组 / 一层嵌套 map）----
export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let nested = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const kv = raw.trim().match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    let val = kv[2].trim();
    if (indent >= 2 && nested) {
      nested[key] = unquote(val);
      continue;
    }
    if (val === '') {
      nested = {};
      meta[key] = nested;
    } else if (val.startsWith('[') && val.endsWith(']')) {
      nested = null;
      meta[key] = val.slice(1, -1).split(',').map(s => unquote(s.trim())).filter(Boolean);
    } else {
      nested = null;
      meta[key] = unquote(val);
    }
  }
  return { meta, body: text.slice(m[0].length) };
}
function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}
export function serializeMeta(meta) {
  const lines = ['---'];
  const order = ['id', 'title', 'folder', 'category', 'tags', 'keywords', 'created', 'status', 'motivation', 'source', 'links', 'review'];
  const keys = [...order.filter(k => k in meta), ...Object.keys(meta).filter(k => !order.includes(k))];
  for (const k of keys) {
    const v = meta[k];
    if (Array.isArray(v)) lines.push(`${k}: [${v.join(', ')}]`);
    else if (v && typeof v === 'object') {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v)) lines.push(`  ${sk}: ${sv === '' ? '""' : sv}`);
    } else lines.push(`${k}: ${v === '' ? '""' : v}`);
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

export function section(body, name) {
  const re = new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  const m = body.match(re);
  return m ? m[1].trim() : '';
}

export function loadCards() {
  if (!fs.existsSync(CARDS_DIR)) return [];
  return fs.readdirSync(CARDS_DIR).filter(f => f.endsWith('.md')).map(f => {
    const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(CARDS_DIR, f), 'utf8'));
    return { file: f, meta, body };
  }).filter(c => c.meta.id);
}

export function linkNotesOf(body) {
  const notes = {};
  for (const m of section(body, '关联').matchAll(/^-\s*\[\[([^\]]+)\]\]\s*(.*)$/gm)) notes[m[1]] = m[2].trim();
  return notes;
}

export function buildIndex() {
  ensureDirs();
  const cards = loadCards().map(({ file, meta, body }) => ({
    id: meta.id,
    title: meta.title || '',
    folder: folderOf(meta),
    category: categoryOf(meta),
    status: statusOf(meta),
    tags: meta.tags || [],
    keywords: meta.keywords || [],
    motivation: meta.motivation || '',
    source: meta.source || '',
    created: meta.created || '',
    links: meta.links || [],
    linkNotes: linkNotesOf(body),
    question: plain(section(body, '问题')),
    review: meta.review || {},
    file
  }));
  fs.writeFileSync(INDEX_FILE, JSON.stringify({ updated: today(), cards }, null, 2));
  return cards;
}

export function readIndex() {
  if (!fs.existsSync(INDEX_FILE)) return buildIndex();
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')).cards; }
  catch { return buildIndex(); }
}

export function nextId() {
  const d = today().replace(/-/g, '');
  const prefix = `kc-${d}-`;
  const seqs = loadCards().map(c => c.meta.id).filter(id => id.startsWith(prefix))
    .map(id => Number(id.slice(prefix.length))).filter(Number.isFinite);
  const next = (seqs.length ? Math.max(...seqs) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// ---- 检索：ASCII 词 + 中文双字分词，按字段加权 ----
export function tokenize(s) {
  const lower = (s || '').toLowerCase();
  const tokens = new Set();
  for (const w of lower.match(/[a-z0-9][a-z0-9._-]*/g) || []) if (w.length >= 2) tokens.add(w);
  for (const run of lower.match(/[一-鿿]+/g) || []) {
    if (run.length === 1) tokens.add(run);
    for (let i = 0; i + 2 <= run.length; i++) tokens.add(run.slice(i, i + 2));
  }
  return [...tokens];
}
export function scoreCard(card, qTokens) {
  const fields = [
    [card.tags.join(' '), 5],
    [card.keywords.join(' '), 4],
    [card.title, 3],
    [card.question, 1.5],
    [card.motivation, 1]
  ].map(([t, w]) => [(t || '').toLowerCase(), w]);
  let score = 0;
  const hits = [];
  for (const t of qTokens) {
    let best = 0;
    for (const [text, w] of fields) if (text.includes(t)) best = Math.max(best, w);
    if (best > 0) hits.push(t);
    score += best;
  }
  return { score, hits };
}

// ---- 遗忘曲线调度（SM-2 改良，参考背单词软件：记住逐级拉长、模糊小幅拉长、忘了打回重学）----
// good 阶梯 1→3→7→之后 ×ease 指数扩张；hard ×1.2 且降 ease；forgot 重置 1 天重学、扣 ease、计 lapse。
export function schedule(review, result) {
  let ease = Number(review.ease ?? 2.5);
  let interval = Number(review.interval ?? 0);
  let reps = Number(review.reps ?? 0);
  let lapses = Number(review.lapses ?? 0);
  const clampEase = e => Math.min(3.0, Math.max(1.3, Math.round(e * 100) / 100));
  if (result === 'forgot') {
    ease = clampEase(ease - 0.2); interval = 1; reps = 0; lapses += 1;
  } else if (result === 'hard') {
    ease = clampEase(ease - 0.15); interval = interval <= 0 ? 1 : Math.max(1, Math.round(interval * 1.2)); reps += 1;
  } else if (result === 'good') {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : reps === 2 ? 7 : Math.max(1, Math.round(interval * ease)); reps += 1;
  }
  return {
    ease: clampEase(ease),
    interval, reps, lapses,
    due: result === 'skip' ? (review.due || today()) : addDays(today(), interval),
    last: today()
  };
}
// 预览某评定后的间隔天数（用于复习按钮上的"→ N天后"反馈）
export function previewInterval(review, result) {
  return schedule(review, result).interval;
}

export function findCard(id) {
  const c = loadCards().find(c => c.meta.id === id);
  if (!c) return null;
  return { ...c, abs: path.join(CARDS_DIR, c.file) };
}
function fail(msg) {
  console.error(JSON.stringify({ error: msg }));
  process.exit(1);
}
function out(obj) { console.log(JSON.stringify(obj, null, 2)); }

// ---- 图谱 HTML（自包含，无 CDN）----
export function graphHTML(cards) {
  const nodes = cards.map(c => ({
    id: c.id, title: c.title, folder: c.folder || folderOf(c), category: c.category || categoryOf(c), status: c.status || 'active',
    motivation: c.motivation, due: c.review.due || '', reps: Number(c.review.reps || 0),
    deg: 0
  }));
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const seen = new Map();
  const edges = [];
  for (const c of cards) for (const l of c.links || []) {
    if (!byId[l]) continue;
    const key = [c.id, l].sort().join('|');
    const note = (c.linkNotes || {})[l] || '';
    const label = note ? (note.split(/[：:]/)[0].trim() || note).slice(0, 10) : '';
    if (seen.has(key)) {
      const e = seen.get(key);
      if (!e.label && label) e.label = label;
      continue;
    }
    const e = { s: c.id, t: l, label };
    seen.set(key, e);
    edges.push(e);
    byId[c.id].deg++; byId[l].deg++;
  }
  const data = JSON.stringify({ nodes, edges, today: today() });
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>recall-cards 知识图谱</title>
<style>
  html,body{margin:0;height:100%;background:#0b0f1a;color:#e6ecf7;font-family:"Microsoft YaHei",sans-serif;overflow:hidden}
  #side{position:fixed;top:0;left:0;width:260px;height:100%;padding:16px;box-sizing:border-box;background:#141b2d;border-right:1px solid #263149;overflow:auto}
  #side h1{font-size:16px;margin:0 0 8px} #side p{font-size:12px;color:#93a0ba;line-height:1.7;margin:8px 0}
  .fl{display:block;font-size:12px;color:#93a0ba;margin:10px 0 4px}
  #catsel{width:100%;background:#1a2338;border:1px solid #33415f;color:#e6ecf7;border-radius:8px;padding:7px 9px;font-size:13px;font-family:inherit;cursor:pointer}
  #catsel:focus{outline:none;border-color:#6c8cff}
  .legend{margin-top:10px}
  .lg{display:inline-flex;align-items:center;margin:3px 6px 3px 0;font-size:12px;color:#aab6cf;background:#1a2338;border:1px solid #263149;border-radius:7px;padding:3px 9px;cursor:pointer;transition:.15s}
  .lg:hover{border-color:#6c8cff} .lg.on{border-color:#6c8cff;color:#fff;background:#22304d}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}
  #tip{position:fixed;display:none;max-width:300px;background:#1a2338;border:1px solid #33415f;border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.7;pointer-events:none;z-index:9}
  #tip b{font-size:13px} #tip .mo{color:#ffc861}
  canvas{position:fixed;top:0;left:260px}
</style></head><body>
<div id="side"><h1>知识图谱</h1><p id="stats"></p>
<label class="fl">显示大类</label><select id="catsel"></select>
<p>每个大类聚成一簇、彼此分开；选单一大类可只看该类知识网络。<br>颜色 = 大类；黄描边 = 今日到期；虚线圆 = 待确认草稿；连线文字 = 知识间关系。<br>拖动节点调整布局，悬停查看大类与提问动机。</p>
<div class="legend" id="legend"></div></div>
<div id="tip"></div><canvas id="cv"></canvas>
<script>
const DATA = ${data};
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const tip = document.getElementById('tip');
let W, H; function resize(){ W = innerWidth - 260; H = innerHeight; cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio; cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); }
addEventListener('resize', () => { resize(); build(selected); }); resize();
const palette = ['#6c8cff','#4fd1c5','#ffc861','#ff7a9c','#b08cff','#57d9a3','#ff9f6c','#7aa2ff'];
const allCats = [...new Set(DATA.nodes.map(n => n.category))].sort((a,b)=>a.localeCompare(b,'zh'));
const color = t => palette[allCats.indexOf(t) % palette.length];
let selected = '', N = [], E = [], centers = [];
function build(sel){
  selected = sel;
  const nodes = DATA.nodes.filter(n => !sel || n.category === sel);
  const ids = new Set(nodes.map(n => n.id));
  const edges = DATA.edges.filter(e => ids.has(e.s) && ids.has(e.t));
  const deg = {}; nodes.forEach(n => deg[n.id] = 0); edges.forEach(e => { deg[e.s]++; deg[e.t]++; });
  const cats = [...new Set(nodes.map(n => n.category))].sort((a,b)=>a.localeCompare(b,'zh'));
  const cx0 = W*0.5, cy0 = H*0.52, R = Math.min(W,H)*0.30;
  centers = cats.map((c,i) => {
    const ang = -Math.PI/2 + i*2*Math.PI/cats.length;
    const x = cats.length === 1 ? cx0 : cx0 + R*Math.cos(ang);
    const y = cats.length === 1 ? cy0 : cy0 + R*Math.sin(ang);
    const count = nodes.filter(n => n.category === c).length;
    return { name:c, x, y, count, rad: 26 + Math.sqrt(count)*26 };
  });
  const cmap = Object.fromEntries(centers.map(c => [c.name, c]));
  N = nodes.map(n => { const c = cmap[n.category], a = Math.random()*6.283, rr = Math.random()*c.rad*0.6;
    return {...n, deg:deg[n.id], cx:c.x, cy:c.y, x:c.x+Math.cos(a)*rr, y:c.y+Math.sin(a)*rr, vx:0, vy:0, r:7+Math.min(10,deg[n.id]*2)}; });
  const byId = Object.fromEntries(N.map(n => [n.id, n]));
  E = edges.map(e => ({s:byId[e.s], t:byId[e.t], label:e.label})).filter(e => e.s && e.t);
  const drafts = N.filter(n => n.status === 'draft').length;
  document.getElementById('stats').textContent = N.length + ' 张卡片 · ' + E.length + ' 条关联 · ' + N.filter(n => n.due && n.due <= DATA.today && n.status!=='draft').length + ' 张今日到期' + (drafts ? ' · ' + drafts + ' 张待确认' : '');
  document.getElementById('legend').innerHTML = '<span class="lg' + (!sel?' on':'') + '" data-cat="">全部</span>' + allCats.map(t => '<span class="lg' + (sel===t?' on':'') + '" data-cat="' + t + '"><i class="dot" style="background:' + color(t) + '"></i>' + t + '（' + DATA.nodes.filter(n=>n.category===t).length + '）</span>').join('');
  document.querySelectorAll('#legend .lg').forEach(el => el.addEventListener('click', () => { document.getElementById('catsel').value = el.dataset.cat; build(el.dataset.cat); }));
}
const selEl = document.getElementById('catsel');
selEl.innerHTML = '<option value="">全部大类</option>' + allCats.map(t => '<option value="' + t + '">' + t + '</option>').join('');
selEl.addEventListener('change', () => build(selEl.value));
build('');
let drag = null, hover = null;
cv.addEventListener('mousedown', e => { const n = pick(e.offsetX, e.offsetY); if (n) drag = n; });
addEventListener('mouseup', () => drag = null);
cv.addEventListener('mousemove', e => { const mx = e.offsetX, my = e.offsetY; if (drag) { drag.x = mx; drag.y = my; drag.vx = drag.vy = 0; } hover = pick(mx, my);
  if (hover) { tip.style.display = 'block'; tip.style.left = Math.min(innerWidth - 320, e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
    tip.innerHTML = '<b>' + esc(hover.title) + '</b><br>文件夹：' + esc(hover.folder) + ' · 大类：' + esc(hover.category) + (hover.status==='draft' ? ' · <span style="color:#ffc861">待确认草稿</span>' : '') + ' · 复习 ' + hover.reps + ' 次' + (hover.due ? '<br>下次复习：' + hover.due : '') + (hover.motivation ? '<br><span class="mo">当时为什么问：' + esc(hover.motivation) + '</span>' : '');
  } else tip.style.display = 'none'; });
function pick(x, y){ for (const n of N) if ((n.x-x)**2 + (n.y-y)**2 < (n.r+4)**2) return n; return null; }
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function tick(){
  for (const a of N) { a.vx += (a.cx - a.x) * 0.012; a.vy += (a.cy - a.y) * 0.012;
    for (const b of N) { if (a === b) continue; let dx = a.x-b.x, dy = a.y-b.y, d2 = dx*dx+dy*dy || 1;
      if (d2 < 160000) { const f = 1500/(d2*Math.sqrt(d2)); a.vx += dx*f; a.vy += dy*f; } } }
  for (const e of E) { const dx = e.t.x-e.s.x, dy = e.t.y-e.s.y, d = Math.sqrt(dx*dx+dy*dy)||1, f = (d-80)*0.005;
    e.s.vx += dx/d*f; e.s.vy += dy/d*f; e.t.vx -= dx/d*f; e.t.vy -= dy/d*f; }
  for (const n of N) { if (n === drag) continue; n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy;
    n.x = Math.max(n.r+4, Math.min(W-n.r-4, n.x)); n.y = Math.max(n.r+4, Math.min(H-n.r-4, n.y)); }
  ctx.clearRect(0,0,W,H);
  for (const c of centers) { ctx.strokeStyle = 'rgba(120,140,180,.20)'; ctx.lineWidth = 1; ctx.setLineDash([5,7]);
    ctx.beginPath(); ctx.arc(c.x, c.y, c.rad, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(165,180,210,.6)'; ctx.font = '13px "Microsoft YaHei"'; ctx.textAlign = 'center';
    ctx.fillText(c.name, c.x, Math.max(14, c.y - c.rad - 8)); }
  ctx.strokeStyle = '#2c3a58'; ctx.lineWidth = 1.2;
  for (const e of E) { ctx.beginPath(); ctx.moveTo(e.s.x, e.s.y); ctx.lineTo(e.t.x, e.t.y); ctx.stroke();
    if (e.label) { ctx.fillStyle = '#93a0ba'; ctx.font = '11px "Microsoft YaHei"'; ctx.textAlign = 'center';
      ctx.fillText(e.label, (e.s.x+e.t.x)/2, (e.s.y+e.t.y)/2 - 5); } }
  for (const n of N) { const draft = n.status === 'draft'; ctx.globalAlpha = draft ? 0.55 : 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.283); ctx.fillStyle = color(n.category); ctx.fill();
    if (draft) { ctx.strokeStyle = '#ffc861'; ctx.lineWidth = 1.5; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]); }
    if (n.due && n.due <= DATA.today && !draft) { ctx.strokeStyle = '#ffc861'; ctx.lineWidth = 2.5; ctx.stroke(); }
    if (n === hover) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = n === hover ? '#fff' : '#aab6cf'; ctx.font = '12px "Microsoft YaHei"'; ctx.textAlign = 'center';
    ctx.fillText(n.title.length > 14 ? n.title.slice(0,13)+'…' : n.title, n.x, n.y + n.r + 15); ctx.globalAlpha = 1; }
  requestAnimationFrame(tick);
}
tick();
</script></body></html>`;
}

// ---- CLI ----
function runCLI() {
  const [cmd, ...args] = process.argv.slice(2);
  const flag = (name, def) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : def;
  };

  switch (cmd) {
    case 'reindex': {
      const cards = buildIndex();
      out({ ok: true, root: ROOT, count: cards.length });
      break;
    }
    case 'next-id': {
      out({ id: nextId() });
      break;
    }
    case 'search': {
      const q = flag('q', '');
      if (!q) fail('用法: search --q "问题关键词" [--limit 8]');
      const limit = Number(flag('limit', 8));
      const qTokens = tokenize(q);
      const results = readIndex().filter(c => c.status !== 'draft').map(c => ({ ...c, ...scoreCard(c, qTokens) }))
        .filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)
        .map(c => ({ id: c.id, title: c.title, category: c.category, score: c.score, hits: c.hits, tags: c.tags, motivation: c.motivation, links: c.links, question: c.question, due: c.review.due || '' }));
      out({ query: q, tokens: qTokens, results });
      break;
    }
    case 'due': {
      const t = today();
      const all = args.includes('--all');
      const cards = readIndex().filter(c => c.status !== 'draft').filter(c => all || !c.review.due || c.review.due <= t)
        .sort((a, b) => (a.review.due || '').localeCompare(b.review.due || ''))
        .map(c => ({ id: c.id, title: c.title, category: c.category, tags: c.tags, motivation: c.motivation, question: c.question, due: c.review.due || t, reps: Number(c.review.reps || 0), lapses: Number(c.review.lapses || 0) }));
      out({ today: t, count: cards.length, cards });
      break;
    }
    case 'record': {
      const id = args[0];
      const result = flag('result', '');
      if (!id || !['good', 'hard', 'forgot', 'skip'].includes(result)) fail('用法: record <id> --result good|hard|forgot|skip');
      const c = findCard(id);
      if (!c) fail(`找不到卡片 ${id}`);
      const review = schedule(c.meta.review || {}, result);
      c.meta.review = review;
      const line = `- ${today()} ${result}（间隔 ${review.interval} 天，下次 ${review.due}）`;
      let body = c.body;
      if (/##\s*复习记录/.test(body)) body = body.replace(/(##\s*复习记录\s*\n)/, `$1${line}\n`);
      else body = body.trimEnd() + `\n\n## 复习记录\n\n${line}\n`;
      fs.writeFileSync(c.abs, serializeMeta(c.meta) + body);
      buildIndex();
      out({ ok: true, id, result, review });
      break;
    }
    case 'confirm': {
      const id = args[0];
      if (!id) fail('用法: confirm <id>（草稿确认入库）');
      const c = findCard(id);
      if (!c) fail(`找不到卡片 ${id}`);
      c.meta.status = 'active';
      c.meta.review = { ...(c.meta.review || {}), due: today() };
      fs.writeFileSync(c.abs, serializeMeta(c.meta) + c.body);
      buildIndex();
      out({ ok: true, id, status: 'active', due: today() });
      break;
    }
    case 'link': {
      const [a, b] = args;
      if (!a || !b) fail('用法: link <idA> <idB>（双向）');
      for (const [self, other] of [[a, b], [b, a]]) {
        const c = findCard(self);
        if (!c) fail(`找不到卡片 ${self}`);
        const links = new Set(c.meta.links || []);
        links.add(other);
        c.meta.links = [...links];
        fs.writeFileSync(c.abs, serializeMeta(c.meta) + c.body);
      }
      buildIndex();
      out({ ok: true, linked: [a, b] });
      break;
    }
    case 'graph': {
      ensureDirs();
      const cards = readIndex();
      const outFile = flag('out', path.join(ROOT, 'graph.html'));
      fs.writeFileSync(outFile, graphHTML(cards));
      out({ ok: true, file: outFile, nodes: cards.length });
      break;
    }
    case 'stats': {
      const cards = readIndex();
      const t = today();
      const tagCount = {};
      for (const c of cards) for (const tag of c.tags) tagCount[tag] = (tagCount[tag] || 0) + 1;
      const catCount = {};
      for (const c of cards) catCount[c.category] = (catCount[c.category] || 0) + 1;
      const folderCount = {};
      for (const c of cards) folderCount[c.folder || '默认'] = (folderCount[c.folder || '默认'] || 0) + 1;
      const edgeSet = new Set();
      for (const c of cards) for (const l of c.links) edgeSet.add([c.id, l].sort().join('|'));
      out({
        root: ROOT, total: cards.length,
        drafts: cards.filter(c => c.status === 'draft').length,
        dueToday: cards.filter(c => c.status !== 'draft' && (!c.review.due || c.review.due <= t)).length,
        links: edgeSet.size,
        folders: Object.entries(folderCount).sort((a, b) => b[1] - a[1]),
        categories: Object.entries(catCount).sort((a, b) => b[1] - a[1]),
        topTags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10),
        createdLast7: cards.filter(c => c.created >= addDays(t, -7)).length,
        totalReps: cards.reduce((s, c) => s + Number(c.review.reps || 0), 0)
      });
      break;
    }
    default:
      console.log(`recall-cards 卡片工具
存储目录: ${ROOT}（可用环境变量 RECALL_CARDS_HOME 覆盖）
命令:
  reindex                          重建索引（新增/手改卡片后执行）
  next-id                          生成今日新卡片 id
  search --q "关键词" [--limit 8]   关键词加权检索（语义关联仍需 AI 判断）
  due [--all]                      列出到期（或全部）卡片
  record <id> --result good|hard|forgot|skip   记录复习结果并调度下次复习
  confirm <id>                     草稿确认入库（开始进入复习调度）
  link <idA> <idB>                 双向建立关联
  graph [--out 路径]                生成自包含知识图谱 HTML
  stats                            统计概览
  serve                            启动本地图形管理台（见 serve.mjs）`);
  }
}

const isMain = process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
if (isMain) runCLI();