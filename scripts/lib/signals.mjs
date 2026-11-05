// signals.mjs: whether a change needs a reviewer, computed only from the real diff. Raise-only and deterministic: same diff,
// same answer. No forecast of how big the work might be, and no config can switch a built-in signal off (config only adds paths).
// The patterns route review attention. They are not a security boundary: the OS sandbox is the boundary.

import { classifyPaths } from './path-facts.mjs';
import { denyListed, foldName, trimDots } from './path-safety.mjs';

export const LARGE_DIFF_LINES = 300;
export const REVIEW_SIGNALS = Object.freeze(['multi-module', 'public-api', 'schema', 'tests-weakened', 'dependency', 'goldens-moved', 'large-diff', 'unreadable-diff']);
// Recorded, but they do not start a review on their own: review on these cost 68% more per task and showed no gain on hidden tests.
export const RECORDED_ONLY = Object.freeze(['multi-module', 'public-api', 'large-diff']);
export const SECURITY_SIGNALS = Object.freeze(['sink', 'secrets', 'network', 'repo-content', 'policy-file', 'sensitive-path', 'unreadable-diff']);

const DOC = /\.(md|mdx|txt|rst|adoc)$/i;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs|e2e|testdata|__mocks__)\/|\.(test|spec)\.[^/]+$|[_-](test|spec)\.[^/]+$|(^|\/)test_[^/]+$/i;
const GOLDEN = /(^|\/)(goldens?|__snapshots__|snapshots)\/|\.(snap|golden)$/i;
const MAX_SCANNED_LINE = 2000;

const SINK = [
  /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork|popen|system|subprocess\.\w+|child_process|ProcessBuilder)\b|shell\s*=\s*True/,
  /\beval\s*\(|\bnew\s+Function\s*\(/,
  /\b(SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b|\.(query|raw|execute)\s*\(/i,
  /\b(readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|unlink|unlinkSync|rmSync|sendFile)\s*\(|\bos\.path\.join\b|\bopen\s*\(/,
  /\b(pickle\.loads?|yaml\.load|unserialize|Marshal\.load|ObjectInputStream|deserialize\w*)\b/,
  /\bnew\s+RegExp\s*\(|\bre\.compile\s*\(/,
];
// No word boundaries: hashPassword and resetToken are the same thing as password and token, and a false alarm here costs one review.
const SECRETS = /password|passwd|secret|credential|private[_-]?key|api[_-]?key|(auth|access|bearer|refresh|reset|session|id)[_-]?token/i;
const NETWORK = /\b(fetch|axios|XMLHttpRequest|WebSocket|urllib\w*|requests\.(get|post|put|delete)|https?\.(request|get)|net\.(connect|createConnection))\b/;
const REPO_CONTENT = /\.gitmodules|\.git\/|core\.hooksPath|\bgit\s+(config|submodule|clone)\b|\.mcp\.json/;
const WEAKENS_TEST = /\.(skip|only|todo)\s*\(|\bx(it|describe|test)\s*\(|@(Ignore|Disabled)\b|pytest\.mark\.skip/;
const ASSERTION = /\b(assert\w*|expect|should)\b|\b(it|test)\s*\(/;
const EXPORT_LINE = /^\s*(export\s+(default\s+|async\s+)?(function|class|const|let|var|type|interface|enum|\{)|module\.exports\b|exports\.\w+\s*=|pub\s+(fn|struct|enum|trait)\b|public\s+[\w<>[\]]+\s+\w+\s*\()/;
const EXPORTED_VALUE = /^\s*export\s+(?:const|let|var)\s+(\w+)/;

// Files an agent's own behaviour hangs on. Frozen as a signal: it routes the security lens and is not hardened further.
function isPolicyFile(file) {
  const segs = file.split(/[\\/]+/).map((s) => trimDots(foldName(s)));
  return ['.claude', 'claude.md', 'claude.local.md', 'agents.md', '.mcp.json', '.gitmodules', '.gitattributes'].some((n) => segs.includes(n))
    || segs.some((s, i) => s === '.vscode' && segs[i + 1] === 'mcp.json')
    || (segs[0] === '.github' && (segs[1] === 'hooks' || segs[1] === 'copilot-instructions.md'))
    || (segs[0] === '.somi' && (segs[1] === 'config.json' || segs[1] === 'rules'));
}

const clip = (text) => (text.length > MAX_SCANNED_LINE ? text.slice(0, MAX_SCANNED_LINE) : text);
// A changed export value keeps the interface, so a constant compares by name. Anything else compares by its whole line, because a
// changed function signature is exactly what the signal is for.
const exportKey = (l) => `${l.file}\n${EXPORTED_VALUE.exec(l.text)?.[1] ?? l.text.trim()}`;
function removesExport(lines) {
  const exports = lines.filter((l) => isCode(l.file) && EXPORT_LINE.test(clip(l.text)));
  const kept = new Set(exports.filter((l) => l.sign === '+').map(exportKey));
  return exports.some((l) => l.sign === '-' && !kept.has(exportKey(l)));
}

const hits = (lines, test) => lines.some((l) => test(clip(l.text)));
const isCode = (file) => !DOC.test(file) && !TEST_FILE.test(file);
const sorted = (set) => [...set].sort();

export function computeSignals({ rows, lines, unreadable = false }, configLayers = []) {
  if (unreadable) return { review: ['unreadable-diff'], security: ['unreadable-diff'], facts: { files: 0, changed_lines: 0, modules: 0 } };
  const review = new Set();
  const security = new Set();
  const files = rows.map((r) => r.file);
  const code = files.filter(isCode);
  const changed = rows.reduce((n, r) => n + r.added + r.deleted, 0);
  if (changed > LARGE_DIFF_LINES) review.add('large-diff');

  const all = classifyPaths(files, configLayers);
  const production = classifyPaths(code, configLayers);
  if (production.modules > 1) review.add('multi-module');
  if (all.contract.includes('schema')) review.add('schema');
  if (all.contract.includes('lockfile') || all.contract.includes('manifest')) review.add('dependency');
  if (files.some((f) => GOLDEN.test(f))) review.add('goldens-moved');

  if (removesExport(lines)) review.add('public-api');

  const testLines = lines.filter((l) => TEST_FILE.test(l.file));
  const assertions = (sign) => testLines.filter((l) => l.sign === sign && ASSERTION.test(clip(l.text))).length;
  const deletedTest = rows.some((r) => TEST_FILE.test(r.file) && r.status.startsWith('D'));
  if (deletedTest || assertions('-') > assertions('+') || hits(testLines.filter((l) => l.sign === '+'), (t) => WEAKENS_TEST.test(t))) review.add('tests-weakened');

  if (production.sensitive.length + production.boundary.length > 0 || files.some(denyListed)) security.add('sensitive-path');
  if (files.some(isPolicyFile)) security.add('policy-file');
  const addedCode = lines.filter((l) => l.sign === '+' && isCode(l.file));
  if (hits(addedCode, (t) => SINK.some((p) => p.test(t)))) security.add('sink');
  if (hits(addedCode, (t) => SECRETS.test(t))) security.add('secrets');
  if (hits(addedCode, (t) => NETWORK.test(t))) security.add('network');
  if (hits(addedCode, (t) => REPO_CONTENT.test(t))) security.add('repo-content');

  return { review: sorted(review), security: sorted(security), facts: { files: files.length, changed_lines: changed, modules: production.modules } };
}
