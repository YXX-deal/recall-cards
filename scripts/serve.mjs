#!/usr/bin/env node
// recall-cards 本地图形管理台服务：仅监听 127.0.0.1，零依赖
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, CARDS_DIR, today, addDays, ensureDirs, serializeMeta, section,
  loadCards, buildIndex, readIndex, tokenize, scoreCard, schedule, previewInterval,
  graphHTML, nextId, findCard, linkNotesOf, plain, categoryOf, statusOf, folderOf,
  normalizeFolder, folderAncestors, isUnder, folderParent
} from './cards.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_FILE = path.join(HERE, '..', 'assets', 'ui.html');
const FOLDERS_FILE = path.join(ROOT, 'folders.json');
const ID_RE = /^kc-\d{8}-\d{3,}$/;
const RESULTS = ['good', 'hard', 'forgot', 'skip'];

// ---- 文件夹注册表（持久化空文件夹与多级路径）----
function readFolders() {
  try {
    const j = JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf8'));
    return Array.isArray(j.folders) ? j.folders.map(normalizeFolder) : [];
  } catch { return []; }
}
function writeFolders(list) {
  ensureDirs();
  // 「默认」不持久化：仅当有卡片归入时由 allFolderPaths 派生显示，空则自动隐藏
  const set = new Set(list.map(normalizeFolder).filter(x => x !== '默认'));
  fs.writeFileSync(FOLDERS_FILE, JSON.stringify({ folders: [...set].sort((a, b) => a.localeCompare(b, 'zh')) }, null, 2));
}
function registerFolder(p) {
  const cur = readFolders();
  const add = folderAncestors(p);
  if (add.every(a => cur.includes(a))) return;
  writeFolders([...cur, ...add]);
}
function allFolderPaths() {
  const set = new Set(readFolders());
  for (const c of loadCards()) for (const a of folderAncestors(folderOf(c.meta))) set.add(a);
  return [...set];
}

function stateCards() {
  return loadCards().map(({ meta, body }) => {
    const review = meta.review || {};
    return {
      ...meta,
      folder: folderOf(meta),
      category: categoryOf(meta),
      status: statusOf(meta),
      question: plain(section(body, '问题')),
      answer: plain(section(body, '答案')),
      linkNotes: linkNotesOf(body),
      log: section(body, '复习记录'),
      preview: { good: previewInterval(review, 'good'), hard: previewInterval(review, 'hard'), forgot: previewInterval(review, 'forgot') }
    };
  });
}
function readConfig() {
  try { return { autoStart: true, ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')) }; }
  catch { return { autoStart: true }; }
}

function noteFor(oldBody, id) {
  const m = section(oldBody || '', '关联').match(new RegExp(`^-\\s*\\[\\[${id}\\]\\]\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}
function assembleBody(p, links, oldBody) {
  const linkLines = links.map(id => {
    const note = noteFor(oldBody, id);
    return `- [[${id}]]${note ? ' ' + note : ''}`;
  }).join('\n');
  return `## 问题\n\n${plain(p.question)}\n\n## 答案\n\n${plain(p.answer)}\n\n## 关联\n\n${linkLines}\n\n## 复习记录\n\n${section(oldBody || '', '复习记录')}\n`;
}
function addLinkNote(body, other, note) {
  const line = `- [[${other}]]${note ? ' ' + note : ''}`;
  if (body.includes(`[[${other}]]`)) {
    return note ? body.replace(new RegExp(`^-\\s*\\[\\[${other}\\]\\][^\\n]*$`, 'm'), line) : body;
  }
  if (/##\s*关联/.test(body)) return body.replace(/(##\s*关联\s*\n)/, `$1${line}\n`);
  return body.trimEnd() + `\n\n## 关联\n\n${line}\n`;
}
function removeLinkNote(body, other) {
  return body.replace(new RegExp(`^-\\s*\\[\\[${other}\\]\\][^\\n]*\\n?`, 'gm'), '');
}
function appendLog(body, line) {
  if (/##\s*复习记录/.test(body)) return body.replace(/(##\s*复习记录\s*\n)/, `$1${line}\n`);
  return body.trimEnd() + `\n\n## 复习记录\n\n${line}\n`;
}
function statsOf(cards) {
  const t = today();
  const tagCount = {};
  for (const c of cards) for (const tag of c.tags || []) tagCount[tag] = (tagCount[tag] || 0) + 1;
  const catCount = {};
  for (const c of cards) catCount[c.category] = (catCount[c.category] || 0) + 1;
  const folderCount = {};
  for (const c of cards) folderCount[c.folder || '默认'] = (folderCount[c.folder || '默认'] || 0) + 1;
  const edgeSet = new Set();
  for (const c of cards) for (const l of c.links || []) edgeSet.add([c.id, l].sort().join('|'));
  return {
    root: ROOT, total: cards.length,
    drafts: cards.filter(c => c.status === 'draft').length,
    dueToday: cards.filter(c => c.status !== 'draft' && (!c.review?.due || c.review.due <= t)).length,
    links: edgeSet.size,
    folders: Object.entries(folderCount).sort((a, b) => b[1] - a[1]),
    categories: Object.entries(catCount).sort((a, b) => b[1] - a[1]),
    topTags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 10),
    createdLast7: cards.filter(c => c.created >= addDays(t, -7)).length,
    totalReps: cards.reduce((s, c) => s + Number(c.review?.reps || 0), 0)
  };
}

let port = 0;
function send(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 1e6) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}
const str = v => typeof v === 'string' ? v : '';
const strArr = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()) : [];

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${port}`);
  const p = u.pathname;
  try {
    if (req.method === 'GET') {
      if (p === '/' || p === '/index.html') {
        const html = fs.readFileSync(UI_FILE);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      if (p === '/graph') {
        const folder = u.searchParams.get('folder') || '';
        const cards = readIndex().filter(c => isUnder(c.folder, folder));
        const html = graphHTML(cards);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      if (p === '/api/ping') return send(res, 200, { ok: true, root: ROOT, pid: process.pid });
      if (p === '/api/config') return send(res, 200, readConfig());
      if (p === '/api/state') return send(res, 200, { root: ROOT, today: today(), cards: stateCards() });
      if (p === '/api/card') {
        const c = stateCards().find(c => c.id === u.searchParams.get('id'));
        return c ? send(res, 200, c) : send(res, 404, { error: '卡片不存在' });
      }
      if (p === '/api/search') {
        const q = u.searchParams.get('q') || '';
        const qt = tokenize(q);
        const results = stateCards().map(c => ({ ...c, ...scoreCard(c, qt) }))
          .filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);
        return send(res, 200, { query: q, results });
      }
      if (p === '/api/due') {
        const t = today();
        const cards = stateCards().filter(c => c.status !== 'draft').filter(c => !c.review?.due || c.review.due <= t)
          .sort((a, b) => (a.review?.due || '').localeCompare(b.review?.due || ''));
        return send(res, 200, { today: t, cards });
      }
      if (p === '/api/categories') {
        const count = {};
        for (const c of stateCards()) count[c.category] = (count[c.category] || 0) + 1;
        return send(res, 200, { categories: Object.entries(count).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, count: n })) });
      }
      if (p === '/api/folders') {
        const paths = allFolderPaths();
        const cards = stateCards();
        const direct = {}, total = {};
        for (const c of cards) {
          direct[c.folder] = (direct[c.folder] || 0) + 1;
          for (const pp of paths) if (isUnder(c.folder, pp)) total[pp] = (total[pp] || 0) + 1;
        }
        const folders = paths.map(pp => ({
          path: pp, name: pp.split('/').pop(), depth: pp.split('/').length,
          count: direct[pp] || 0, total: total[pp] || 0
        })).sort((a, b) => a.path.localeCompare(b.path, 'zh'));
        return send(res, 200, { folders });
      }
      if (p === '/api/stats') return send(res, 200, statsOf(stateCards()));
      return send(res, 404, { error: 'not found' });
    }

    // 写操作：仅接受本机 JSON 请求，拒绝跨站表单/脚本
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`)
      return send(res, 403, { error: 'cross-origin write rejected' });
    if (req.method === 'POST' && !(req.headers['content-type'] || '').includes('application/json'))
      return send(res, 415, { error: 'application/json required' });
    const body = await readBody(req);

    if (req.method === 'POST' && p === '/api/config') {
      if (typeof body.autoStart !== 'boolean') return send(res, 400, { error: 'autoStart 须为布尔值' });
      ensureDirs();
      fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify({ ...readConfig(), autoStart: body.autoStart }, null, 2));
      return send(res, 200, readConfig());
    }
    if (req.method === 'POST' && p === '/api/card') {
      const title = str(body.title).trim();
      if (!title) return send(res, 400, { error: '标题不能为空' });
      const payload = {
        title, tags: strArr(body.tags), keywords: strArr(body.keywords),
        folder: normalizeFolder(body.folder),
        category: str(body.category).trim(),
        motivation: str(body.motivation), source: str(body.source),
        question: str(body.question), answer: str(body.answer)
      };
      const metaFields = {
        title: payload.title, tags: payload.tags, keywords: payload.keywords,
        folder: payload.folder, category: payload.category,
        motivation: payload.motivation, source: payload.source
      };
      const wantStatus = body.status === 'draft' || body.status === 'active' ? body.status : null;
      let meta, oldBody = '', abs;
      if (body.id) {
        if (!ID_RE.test(body.id)) return send(res, 400, { error: '非法 id' });
        const c = findCard(body.id);
        if (!c) return send(res, 404, { error: '卡片不存在' });
        meta = { ...c.meta, ...metaFields, status: wantStatus || statusOf(c.meta) };
        delete meta.question; delete meta.answer; delete meta.why;
        oldBody = c.body; abs = c.abs;
      } else {
        ensureDirs();
        const id = nextId();
        meta = {
          id, ...metaFields, created: today(), status: wantStatus || 'active', links: [],
          review: { ease: 2.5, interval: 0, due: today(), reps: 0, lapses: 0, last: '' }
        };
        abs = path.join(CARDS_DIR, id + '.md');
      }
      fs.writeFileSync(abs, serializeMeta(meta) + assembleBody(payload, meta.links || [], oldBody));
      registerFolder(meta.folder);
      buildIndex();
      return send(res, 200, { ok: true, id: meta.id });
    }
    if (req.method === 'POST' && p === '/api/record') {
      const { id, result } = body;
      if (!ID_RE.test(str(id)) || !RESULTS.includes(result)) return send(res, 400, { error: '参数非法' });
      const c = findCard(id);
      if (!c) return send(res, 404, { error: '卡片不存在' });
      const review = schedule(c.meta.review || {}, result);
      c.meta.review = review;
      const line = `- ${today()} ${result}（间隔 ${review.interval} 天，下次 ${review.due}）`;
      fs.writeFileSync(c.abs, serializeMeta(c.meta) + appendLog(c.body, line));
      buildIndex();
      return send(res, 200, { ok: true, id, review });
    }
    if (req.method === 'POST' && p === '/api/confirm') {
      const id = str(body.id);
      if (!ID_RE.test(id)) return send(res, 400, { error: '非法 id' });
      const c = findCard(id);
      if (!c) return send(res, 404, { error: '卡片不存在' });
      c.meta.status = 'active';
      c.meta.review = { ...(c.meta.review || {}), due: today() };
      fs.writeFileSync(c.abs, serializeMeta(c.meta) + c.body);
      buildIndex();
      return send(res, 200, { ok: true, id, status: 'active', due: today() });
    }
    if (req.method === 'POST' && (p === '/api/link' || p === '/api/unlink')) {
      const { a, b } = body;
      const note = str(body.note).slice(0, 40);
      if (!ID_RE.test(str(a)) || !ID_RE.test(str(b)) || a === b) return send(res, 400, { error: '参数非法' });
      const ca = findCard(a), cb = findCard(b);
      if (!ca || !cb) return send(res, 404, { error: '卡片不存在' });
      const add = p === '/api/link';
      for (const [self, other] of [[ca, cb], [cb, ca]]) {
        const links = new Set(self.meta.links || []);
        add ? links.add(other.meta.id) : links.delete(other.meta.id);
        self.meta.links = [...links];
        const body2 = add ? addLinkNote(self.body, other.meta.id, self === ca ? note : '') : removeLinkNote(self.body, other.meta.id);
        fs.writeFileSync(self.abs, serializeMeta(self.meta) + body2);
      }
      buildIndex();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/folder/create') {
      const raw = str(body.path).trim();
      if (!raw) return send(res, 400, { error: '文件夹名不能为空' });
      const fp = normalizeFolder(raw);
      registerFolder(fp);
      return send(res, 200, { ok: true, path: fp });
    }
    if (req.method === 'POST' && p === '/api/folder/rename') {
      if (!str(body.from).trim() || !str(body.to).trim()) return send(res, 400, { error: '原路径与新路径均不能为空' });
      const from = normalizeFolder(body.from), to = normalizeFolder(body.to);
      if (from === to) return send(res, 200, { ok: true, path: to, changed: 0 });
      let changed = 0;
      for (const c of loadCards()) {
        const f = folderOf(c.meta);
        if (!isUnder(f, from)) continue;
        c.meta.folder = normalizeFolder(to + f.slice(from.length));
        fs.writeFileSync(path.join(CARDS_DIR, c.file), serializeMeta(c.meta) + c.body);
        changed++;
      }
      const reg = readFolders().map(x => isUnder(x, from) ? normalizeFolder(to + x.slice(from.length)) : x);
      writeFolders(reg);
      registerFolder(to);
      buildIndex();
      return send(res, 200, { ok: true, path: to, changed });
    }
    if (req.method === 'POST' && p === '/api/folder/delete') {
      const fp = normalizeFolder(body.path);
      if (fp === '默认') return send(res, 400, { error: '默认文件夹不可删除' });
      const parent = folderParent(fp);
      let moved = 0;
      for (const c of loadCards()) {
        const f = folderOf(c.meta);
        if (!isUnder(f, fp)) continue;
        c.meta.folder = parent === '默认' ? (f === fp ? '默认' : normalizeFolder('默认' + f.slice(fp.length))) : normalizeFolder(parent + f.slice(fp.length));
        fs.writeFileSync(path.join(CARDS_DIR, c.file), serializeMeta(c.meta) + c.body);
        moved++;
      }
      writeFolders(readFolders().filter(x => !isUnder(x, fp)));
      registerFolder(parent);
      buildIndex();
      return send(res, 200, { ok: true, movedTo: parent, moved });
    }
    if (req.method === 'POST' && p === '/api/move') {
      const folder = normalizeFolder(body.folder);
      const ids = (Array.isArray(body.ids) ? body.ids : []).filter(x => ID_RE.test(str(x)));
      if (!ids.length) return send(res, 400, { error: '未选择卡片' });
      const prev = [];
      for (const id of ids) {
        const c = findCard(id);
        if (!c) continue;
        prev.push({ id, folder: folderOf(c.meta) });
        c.meta.folder = folder;
        fs.writeFileSync(c.abs, serializeMeta(c.meta) + c.body);
      }
      registerFolder(folder);
      buildIndex();
      return send(res, 200, { ok: true, moved: prev.length, folder, prev });
    }
    if (req.method === 'POST' && p === '/api/restore') {
      const snap = body.card;
      if (!snap || !ID_RE.test(str(snap.id))) return send(res, 400, { error: '快照非法' });
      if (findCard(snap.id)) return send(res, 409, { error: '卡片已存在' });
      const meta = {
        id: snap.id, title: str(snap.title) || '未命名', folder: normalizeFolder(snap.folder),
        category: str(snap.category), tags: strArr(snap.tags), keywords: strArr(snap.keywords),
        created: str(snap.created) || today(), status: snap.status === 'draft' ? 'draft' : 'active',
        motivation: str(snap.motivation), source: str(snap.source),
        links: (snap.links || []).filter(x => ID_RE.test(str(x))),
        review: snap.review || { ease: 2.5, interval: 0, due: today(), reps: 0, lapses: 0, last: '' }
      };
      const linkLines = meta.links.map(l => `- [[${l}]]${(snap.linkNotes || {})[l] ? ' ' + snap.linkNotes[l] : ''}`).join('\n');
      const bodyText = `## 问题\n\n${plain(snap.question)}\n\n## 答案\n\n${plain(snap.answer)}\n\n## 关联\n\n${linkLines}\n\n## 复习记录\n\n${snap.log || ''}\n`;
      ensureDirs();
      fs.writeFileSync(path.join(CARDS_DIR, snap.id + '.md'), serializeMeta(meta) + bodyText);
      for (const l of meta.links) {
        const o = findCard(l);
        if (!o || (o.meta.links || []).includes(snap.id)) continue;
        o.meta.links = [...(o.meta.links || []), snap.id];
        fs.writeFileSync(o.abs, serializeMeta(o.meta) + addLinkNote(o.body, snap.id, (snap.linkNotes || {})[l] || ''));
      }
      registerFolder(meta.folder);
      buildIndex();
      return send(res, 200, { ok: true, id: snap.id });
    }
    if (req.method === 'DELETE' && p === '/api/card') {
      const id = u.searchParams.get('id') || '';
      if (!ID_RE.test(id)) return send(res, 400, { error: '非法 id' });
      const c = findCard(id);
      if (!c) return send(res, 404, { error: '卡片不存在' });
      const snapshot = stateCards().find(x => x.id === id);
      fs.unlinkSync(c.abs);
      for (const other of loadCards()) {
        if (!(other.meta.links || []).includes(id)) continue;
        other.meta.links = other.meta.links.filter(l => l !== id);
        fs.writeFileSync(path.join(CARDS_DIR, other.file), serializeMeta(other.meta) + removeLinkNote(other.body, id));
      }
      buildIndex();
      return send(res, 200, { ok: true, snapshot });
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});

ensureDirs();
try { writeFolders(allFolderPaths()); } catch {}
// 单例探针：同一存储目录已有实例时直接退出，避免多会话重复拉起
for (let n = 47800; n <= 47809; n++) {
  const existing = await fetch(`http://127.0.0.1:${n}/api/ping`, { signal: AbortSignal.timeout(300) })
    .then(r => r.ok ? r.json() : null).catch(() => null);
  if (existing?.ok && existing.root === ROOT) {
    console.log(JSON.stringify({ url: `http://127.0.0.1:${n}/`, root: ROOT, already: true }));
    process.exit(0);
  }
}
const tryPort = n => {
  server.once('error', e => {
    if (e.code === 'EADDRINUSE' && n < 47809) return tryPort(n + 1);
    console.error(JSON.stringify({ error: String(e.message || e) }));
    process.exit(1);
  });
  server.listen(n, '127.0.0.1', () => {
    port = n;
    console.log(JSON.stringify({ url: `http://127.0.0.1:${n}/`, root: ROOT }));
  });
};
tryPort(47800);