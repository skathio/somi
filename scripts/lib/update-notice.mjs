// update-notice.mjs: SoMi says when it is out of date and never updates itself. The check runs at most once a day in a detached child,
// so a slow or blocked network never delays a session, and a sandbox that refuses it just means no notice. SOMI_NO_UPDATE_CHECK turns it off.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY_MS = 86400000;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cacheFile = (env) => path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'somi', 'latest-version.json');
const installed = () => JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8')).version;

export function isNewer(latest, current) {
  const parts = (v) => String(v).split('-')[0].split('.').map(Number);
  const [a, b] = [parts(latest), parts(current)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

export function updateNotice(env = process.env, now = Date.now()) {
  if (env.SOMI_NO_UPDATE_CHECK) return null;
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(cacheFile(env), 'utf8')); } catch { /* no reading yet */ }
  if (!cached || now - (cached.checked_at ?? 0) > DAY_MS) {
    try {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--refresh'], { detached: true, stdio: 'ignore', env });
      child.unref();
    } catch { /* the notice is a courtesy */ }
  }
  try {
    const current = installed();
    if (cached?.latest && isNewer(cached.latest, current)) return `SoMi ${cached.latest} is available; you have ${current}. Tell the user once. SoMi never updates itself.`;
  } catch { /* the notice is a courtesy */ }
  return null;
}

async function refresh(env = process.env) {
  const res = await fetch('https://registry.npmjs.org/@skathio/somi/latest', { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return;
  const { version } = await res.json();
  const file = cacheFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ latest: version, checked_at: Date.now() }));
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--refresh') refresh().catch(() => {});
