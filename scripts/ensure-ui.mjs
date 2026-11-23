#!/usr/bin/env node
// 按需入口：幂等确保管理台服务驻留（先探针，未活才 detached 拉起）。WorkBuddy 无会话 hook，由 Skill 在打开管理台时调用。
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVE = path.join(HERE, 'serve.mjs');
const ROOT = process.env.RECALL_CARDS_HOME || path.join(os.homedir(), '.recall-cards');

async function ping() {
  for (let port = 47800; port <= 47809; port++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(400) });
      if (r.ok) {
        const j = await r.json();
        if (j.ok && path.resolve(j.root) === path.resolve(ROOT)) return { ...j, port };
      }
    } catch {}
  }
  return null;
}

const alive = await ping();
if (alive) {
  console.log(JSON.stringify({ url: `http://127.0.0.1:${alive.port}/`, root: ROOT, already: true, pid: alive.pid }));
  process.exit(0);
}
const child = spawn(process.execPath, [SERVE], { detached: true, stdio: 'ignore', env: process.env });
child.unref();
// 等待新实例就绪后回报 url
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 150));
  const j = await ping();
  if (j) { console.log(JSON.stringify({ url: `http://127.0.0.1:${j.port}/`, root: ROOT, pid: j.pid })); process.exit(0); }
}
console.log(JSON.stringify({ root: ROOT, started: true, pid: child.pid, note: '服务已拉起，稍后扫 /api/ping 确认 url' }));
process.exit(0);