// quality/run.mjs: the quality gate as a step the synchronous commands can take. somi check and somi pr call it, and it runs the same
// somi quality a person would, so all three agree. A gate that cannot run is not a pass: its failure is reported as a violation.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'somi.mjs');
export const QUALITY_TIMEOUT_MS = 120000;
const MAX_SHOWN = 20;

const describe = (v) => {
  const where = `${v.file}:${v.line}${v.name ? ` ${v.name}` : ''}`;
  if (v.rule === 'clone') return `clone ${where}: ${v.value} lines also at ${v.other.file}:${v.other.line}`;
  return `${v.rule} ${where}: ${v.value} over ${v.limit}${v.before !== undefined ? `, was ${v.before}` : ''}`;
};

/** The gate's own report for one scope, or { error } when it could not run. */
export function runQuality(root, { scope, env = process.env }) {
  const r = spawnSync(process.execPath, [CLI, 'quality', '--scope', scope], { cwd: root, env, encoding: 'utf8', timeout: QUALITY_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 });
  let result = null;
  try { result = JSON.parse(r.stdout); } catch { /* reported below */ }
  if (!result || (r.status !== 0 && r.status !== 1)) return { error: `the quality gate could not run: ${(r.stderr || r.error?.message || 'no output').trim().split('\n')[0].slice(0, 200)}` };
  return result;
}

/** Each violation as one line naming the rule, the place and the numbers, at most MAX_SHOWN of them. */
export function describeAll(violations, scope) {
  const lines = violations.map(describe);
  return lines.length > MAX_SHOWN ? [...lines.slice(0, MAX_SHOWN), `and ${lines.length - MAX_SHOWN} more: somi_quality with scope ${scope} lists them`] : lines;
}

/** { ok, failures: [line], warnings: n } for one scope, where each failure names the rule, the place and the numbers. */
export function qualityStep(root, { scope, env = process.env }) {
  const result = runQuality(root, { scope, env });
  if (result.error) return { ok: false, failures: [result.error], warnings: 0 };
  return { ok: result.ok, failures: describeAll(result.violations, scope), warnings: result.warnings.length };
}
