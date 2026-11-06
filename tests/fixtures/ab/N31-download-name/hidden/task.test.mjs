// SOMI-CANARY-N31-46c26e4c74582d3b
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cases } from './cases.mjs';

// Candidate code only ever runs in a harness-owned child. This process compares the JSON it reports.
const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));
for (const c of cases) {
  test(c.name, () => {
    const nonce = randomUUID();
    const r = spawnSync(process.execPath, [runner, c.name, nonce], { cwd: process.env.TASK_WORKSPACE, env: process.env, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1 << 22 });
    const m = new RegExp('@@' + nonce + '@@(.*)').exec(r.stdout ?? '');
    assert.ok(m, 'the runner reported nothing');
    assert.deepEqual(JSON.parse(m[1]), { value: c.expect });
  });
}
