#!/usr/bin/env node
// SessionStart hook 入口：幂等确保管理台服务驻留（先探针，未活才 detached 拉起）
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVE = path.join(HERE, '..', 'skills', 'recall-cards', 'scripts', 'serve.mjs');
const ROOT = process.env.RECALL_CARDS_HOME || path.join(os.homedir(), '.recall-cards');

try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  if (cfg.autoStart === false) process.exit(0);
} catch {}

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

if (await ping()) process.exit(0);
spawn(process.execPath, [SERVE], { detached: true, stdio: 'ignore', env: process.env }).unref();
process.exit(0);