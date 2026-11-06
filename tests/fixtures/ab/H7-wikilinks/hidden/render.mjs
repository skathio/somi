// SOMI-CANARY-H7-3b8f60d2a1c479e5
// Harness-owned runner: renders the markdown it reads from stdin with the candidate's library and prints the HTML as data.
// The nonce only guards against accidental output; candidate code in this process can read argv, so the real defence is containment.
import { readFileSync } from 'node:fs';

const [, , nonce] = process.argv;
let reply;
try {
  const { md } = JSON.parse(readFileSync(0, 'utf8'));
  const mod = await import(process.env.TASK_WORKSPACE + '/src/index.mjs');
  reply = { html: String(mod.render(md)) };
} catch (e) {
  reply = { error: String(e?.message ?? e).slice(0, 200) };
}
process.stdout.write('\nH7:' + nonce + ':' + JSON.stringify(reply) + '\n', () => process.exit(0));
