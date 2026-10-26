// Lint for micro-task directories (the authoring standard is tests/evals/ab-micro/README.md). Pure checks over a task
// directory's task.json and files: the statement count and length, the words that would trip the pipeline's security floor
// or its first-stage triggers, destructive SQL phrases, the shape of the case table, and drift of the shared runner and test
// file from the template. Reads files (bounded), writes nothing, runs nothing from the task, no model call.
// Findings are {file, rule, message}; formatFindings prints `file: rule: message`. Model names are not checked here: the
// stale-vocabulary gate does that for every shipped and gated file.

import fs from 'node:fs';
import path from 'node:path';

export const LIMITS = Object.freeze({ MIN_STATEMENTS: 5, MAX_STATEMENTS: 8, MAX_STATEMENT_CHARS: 400, MAX_BRIEF_CHARS: 1200, MIN_CASES: 60, MAX_CASES: 120, MAX_FILE_BYTES: 262144 });
export const SHARED_FILES = Object.freeze(['run-family.mjs', 'cases.test.mjs']);
const CANARY_LINE = /^\/\/ SOMI-CANARY-/;

// Words a statement or brief must not contain: the trivial threshold's security-sensitive signal (auth, crypto, secrets, PII,
// untrusted-input boundary) and the neighbours that make a planner or a security pass stop the run. `probe` is a sample the
// pattern must match; the test checks the routing skill's own list against these terms so a change there cannot pass silently.
export const BANNED = Object.freeze([
  { term: 'auth', re: /\b(auth|authn|authz|authenticat\w*|authoriz\w*|login|log in|sign[- ]in|permission\w*)\b/i, probe: 'authentication' },
  { term: 'crypto', re: /\b(crypto\w*|encrypt\w*|decrypt\w*|cipher\w*|hmac|signature|certificate)\b/i, probe: 'cryptography' },
  { term: 'secrets', re: /\b(secrets?|passwords?|passphrase\w*|credentials?|tokens?|sessions?|cookies?|api[- ]keys?|private keys?|oauth|jwt)\b/i, probe: 'secret' },
  { term: 'PII', re: /\b(pii|personal data|personally identifiable|e-?mail|phone numbers?|social security|credit card)\b/i, probe: 'PII' },
  { term: 'untrusted-input', re: /\buntrusted[- ]input\b/i, probe: 'untrusted input' },
]);
// A destructive SQL phrase anywhere in a task is refused: tooling that guards shells and files treats it as an attack.
const DESTRUCTIVE_SQL = /\b(drop\s+(table|database|schema)|delete\s+from|truncate\s+table)\b/i;
const MODULE_PATH = /^[A-Za-z0-9._-]+$/;

const finding = (file, rule, message) => ({ file, rule, message });
export const formatFindings = (list) => list.map((f) => `${f.file}: ${f.rule}: ${f.message}`).join('\n');

function readBounded(file) {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > LIMITS.MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}
function* filesUnder(dir, depth = 0) {
  if (depth > 6) return;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* filesUnder(p, depth + 1); else if (e.isFile()) yield p;
  }
}

/** Pure text rules over a parsed task.json (`label` names the file in findings). */
export function lintStatements(task, label = 'task.json') {
  const out = [];
  const st = task?.statements;
  if (!Array.isArray(st)) return [finding(label, 'statement-count', 'statements is not an array')];
  if (st.length < LIMITS.MIN_STATEMENTS || st.length > LIMITS.MAX_STATEMENTS) out.push(finding(label, 'statement-count', `${st.length} statements, the standard asks for ${LIMITS.MIN_STATEMENTS} to ${LIMITS.MAX_STATEMENTS}`));
  st.forEach((s, i) => {
    if (typeof s !== 'string') return out.push(finding(label, 'statement-length', `statement ${i + 1} is not text`));
    if (s.length > LIMITS.MAX_STATEMENT_CHARS) out.push(finding(label, 'statement-length', `statement ${i + 1} has ${s.length} characters, the limit is ${LIMITS.MAX_STATEMENT_CHARS}`));
    if (/^\s*\d+[.)]\s/.test(s)) out.push(finding(label, 'statement-numbering', `statement ${i + 1} carries its own number; the position in the list is the number`));
  });
  if (typeof task.brief !== 'string' || task.brief.length === 0 || task.brief.length > LIMITS.MAX_BRIEF_CHARS) out.push(finding(label, 'brief-length', `the brief needs 1 to ${LIMITS.MAX_BRIEF_CHARS} characters`));
  if (!Array.isArray(task.source) || task.source.length !== 1 || String(task.source[0]).endsWith('/')) out.push(finding(label, 'source-count', 'declare exactly one source file (one named export in one file)'));
  const texts = [...st.map((s, i) => [`statement ${i + 1}`, s]), ['brief', task.brief]];
  for (const [where, text] of texts) {
    if (typeof text !== 'string') continue;
    for (const b of BANNED) { const m = b.re.exec(text); if (m) out.push(finding(label, 'banned-word', `${where} contains "${m[0]}" (${b.term}: it would trip the security floor or a first-stage trigger)`)); }
  }
  return out;
}

/** The case table of hidden/cases.json: shape, unique test names, statement numbers in range, case count. */
export function lintCaseTable(table, statementCount, { minCases = LIMITS.MIN_CASES, maxCases = LIMITS.MAX_CASES } = {}, label = 'hidden/cases.json') {
  const out = [];
  if (table === null || typeof table !== 'object' || !Array.isArray(table.families) || table.families.length === 0) return [finding(label, 'case-table', 'families must be a non-empty array')];
  if (typeof table.module !== 'string' || !MODULE_PATH.test(table.module) || typeof table.export !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(table.export)) out.push(finding(label, 'case-table', 'module and export must be plain names'));
  const names = new Set(); let total = 0;
  for (const f of table.families) {
    if (typeof f?.name !== 'string' || !/^[a-z][a-z-]{1,20}$/.test(f.name) || !Array.isArray(f.cases)) { out.push(finding(label, 'case-table', 'a family needs a lowercase name and a cases array')); continue; }
    for (const c of f.cases) {
      total++;
      if (typeof c?.id !== 'string' || !Number.isInteger(c.ac) || c.ac < 1 || c.ac > statementCount || !Array.isArray(c.args) || typeof c.want !== 'object' || c.want === null || !('value' in c.want || 'throws' in c.want)) { out.push(finding(label, 'case-table', `a case in family ${f.name} is malformed or cites a statement that does not exist`)); continue; }
      const name = `AC${c.ac} [${f.name}] ${c.id}`;
      if (names.has(name)) out.push(finding(label, 'case-table', `duplicate test name ${name}`));
      names.add(name);
    }
  }
  if (total < minCases || total > maxCases) out.push(finding(label, 'case-count', `${total} cases, the standard asks for ${minCases} to ${maxCases}`));
  return out;
}

const withoutCanary = (text) => text.split('\n').filter((l) => !CANARY_LINE.test(l)).join('\n');

/** Every rule over one task directory. `templateDir` holds the shared files; `opts` bounds the case count. */
export function lintTask(taskDir, templateDir, opts = {}) {
  const name = path.basename(taskDir);
  const out = [];
  const raw = readBounded(path.join(taskDir, 'task.json'));
  let task = null;
  try { task = JSON.parse(raw); } catch { /* reported below */ }
  if (task === null || typeof task !== 'object') return [finding(`${name}/task.json`, 'task-json', 'missing or not valid JSON')];
  out.push(...lintStatements(task, `${name}/task.json`));
  for (const f of filesUnder(taskDir)) {
    const text = readBounded(f);
    if (text !== null && DESTRUCTIVE_SQL.test(text)) out.push(finding(`${name}/${path.relative(taskDir, f)}`, 'destructive-sql', 'a destructive SQL phrase is not allowed anywhere in a task'));
  }
  for (const file of SHARED_FILES) {
    const copy = readBounded(path.join(taskDir, 'hidden', file));
    const shared = readBounded(path.join(templateDir, file));
    if (copy === null) out.push(finding(`${name}/hidden/${file}`, 'runner-missing', 'the shared file is not in hidden/'));
    else if (shared === null) out.push(finding(`${templateDir}/${file}`, 'runner-missing', 'the template file is missing'));
    else if (withoutCanary(copy) !== withoutCanary(shared)) out.push(finding(`${name}/hidden/${file}`, 'runner-drift', 'differs from the template copy beyond the canary line; copy the template file again'));
  }
  const table = readBounded(path.join(taskDir, 'hidden', 'cases.json'));
  let parsed = null;
  try { parsed = JSON.parse(table); } catch { /* reported below */ }
  if (parsed === null) out.push(finding(`${name}/hidden/cases.json`, 'case-table', 'missing or not valid JSON'));
  else out.push(...lintCaseTable(parsed, Array.isArray(task.statements) ? task.statements.length : 0, opts, `${name}/hidden/cases.json`));
  return out;
}

/** Every task directory (one holding a task.json) directly under `corpusDir`. */
export function lintCorpus(corpusDir, templateDir, opts = {}) {
  let names = [];
  try { names = fs.readdirSync(corpusDir, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(corpusDir, e.name, 'task.json'))).map((e) => e.name).sort(); } catch { /* no corpus */ }
  return names.flatMap((n) => lintTask(path.join(corpusDir, n), templateDir, opts));
}
