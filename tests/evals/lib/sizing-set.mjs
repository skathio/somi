// The labelled sizing set: requests with the tier a person confirmed for each, the yardstick the sizing step is
// measured against. This module loads the set, refuses a malformed one, and computes a hash that binds a recorded
// run to the exact labels it was scored against.
//
// An entry is one of two kinds, told apart by its keys:
//   corpus    { id, label, reason, task }             `task` is "<corpus>/<name>", a directory of tests/evals with a
//                                                     task.json; its own fixture is the workspace.
//   authored  { id, label, reason, request, fixture } `fixture` names a directory directly under tests/evals/fixtures/
//                                                     that a run copies as its workspace; the model can only name a
//                                                     real path if a tree exists.
// Either kind may carry `sensitive: true` (a security-floor case): its label must then be `full`.
//
// Closed grammar: an unknown key is refused, because a key outside the hash would be a way to change the set unseen.
// Pure reads; no network, no model. A problem is reported as a string and never throws; loadSet throws with all of them.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TIERS = Object.freeze(['trivial', 'small', 'full']);
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const SET_FILE = path.join(REPO_ROOT, 'tests', 'evals', 'sizing-set', 'set.json');

const ID = /^[A-Za-z][A-Za-z0-9]{0,15}$/;
const TASK = /^(ab|ab-micro)\/[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const FIXTURE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const KEYS = new Set(['id', 'label', 'reason', 'task', 'request', 'fixture', 'sensitive']);
const MAX_TEXT = 1000;
const MAX_FILE = 256 * 1024;

const isText = (v) => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_TEXT && !CONTROL.test(v);
const kindOf = (e) => (Object.hasOwn(e, 'task') ? 'corpus' : 'authored');
export const isFloorCase = (e) => e.sensitive === true;
// The probe scenario id of an entry; the corpus scenarios already in use (S4-M01, S4-T1) follow the same rule.
export const scenarioId = (e) => `S4-${e.id}`;

// What lstat says about `p`: 'dir', 'link', 'other' or null when it is absent. Never follows a link.
function kindAt(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'other';
  } catch {
    return null;
  }
}

function entryProblems(e, at, root) {
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return [`${at} is not an object`];
  const out = Object.keys(e).filter((k) => !KEYS.has(k)).map((k) => `${at} has an unknown key ${JSON.stringify(k)}`);
  if (typeof e.id !== 'string' || !ID.test(e.id)) out.push(`${at} needs an id of letters and digits`);
  if (e.label === undefined) out.push(`${at} has no label`);
  else if (!TIERS.includes(e.label)) out.push(`${at} has an unknown tier ${JSON.stringify(e.label)}`);
  if (!isText(e.reason)) out.push(`${at} needs a reason`);
  if (e.sensitive !== undefined && typeof e.sensitive !== 'boolean') out.push(`${at} sensitive must be a boolean`);
  if (isFloorCase(e) && TIERS.includes(e.label) && e.label !== 'full') out.push(`${at} is sensitive, so the security floor makes its label full, not ${e.label}`);
  if (kindOf(e) === 'corpus') {
    if (Object.hasOwn(e, 'fixture') || Object.hasOwn(e, 'request')) out.push(`${at} is a corpus entry and carries a fixture or a request; its task supplies both`);
    if (typeof e.task !== 'string' || !TASK.test(e.task)) out.push(`${at} needs a task like ab/T1-proration`);
    else if (kindAt(path.join(root, 'tests', 'evals', e.task)) !== 'dir' || kindAt(path.join(root, 'tests', 'evals', e.task, 'task.json')) !== 'other') out.push(`${at} names a corpus task that does not exist: ${e.task}`);
    return out;
  }
  if (!isText(e.request)) out.push(`${at} is an authored entry and needs request text`);
  if (typeof e.fixture !== 'string') out.push(`${at} is an authored entry and needs a fixture`);
  else if (e.fixture.startsWith('_')) out.push(`${at} fixture must start with a letter or digit; underscore directories under tests/evals/fixtures/ are not fixtures`);
  else if (!FIXTURE.test(e.fixture) || e.fixture.includes('..')) out.push(`${at} fixture must be a plain directory name directly under tests/evals/fixtures/`);
  else {
    const k = kindAt(path.join(root, 'tests', 'evals', 'fixtures', e.fixture));
    if (k === null) out.push(`${at} fixture does not exist: ${e.fixture}`);
    else if (k === 'link') out.push(`${at} fixture is a symlink`);
    else if (k !== 'dir') out.push(`${at} fixture is not a directory`);
  }
  return out;
}

// Every problem with `set` as a list of strings (empty = valid). `root` is the repository root.
export function validateSet(set, { root = REPO_ROOT } = {}) {
  if (set === null || typeof set !== 'object' || Array.isArray(set)) return ['the set is not an object'];
  const out = [];
  if (set.schema_version !== 1) out.push('schema_version must be 1');
  if (!Array.isArray(set.entries) || set.entries.length === 0) return [...out, 'entries must be a non-empty list'];
  const seen = new Set();
  set.entries.forEach((e, i) => {
    out.push(...entryProblems(e, `entry ${i}${e && typeof e.id === 'string' ? ` (${e.id})` : ''}`, root));
    if (e && typeof e.id === 'string') { if (seen.has(e.id)) out.push(`duplicate id ${e.id}`); seen.add(e.id); }
  });
  return out;
}

// sha256 of the canonical form of what a score depends on: per entry its id, label, sensitive flag, task, fixture and
// request text, in id order. The reason is prose and is not hashed. A re-labelled, re-worded or re-homed set is a
// different set; key order and entry order are not part of it.
export function labelHash(set) {
  const rows = set.entries.map((e) => [e.id, e.label, e.sensitive === true, e.task ?? null, e.fixture ?? null, e.request ?? null]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(['somi-sizing-set-v1', rows])).digest('hex');
}

// The committed set (or `file`), parsed and validated; throws one Error that lists every problem.
export function loadSet(file = SET_FILE, { root = REPO_ROOT } = {}) {
  let set;
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (text.length > MAX_FILE) throw new Error('too large');
    set = JSON.parse(text);
  } catch (e) {
    throw new Error(`sizing set unreadable: ${e.message}`);
  }
  const problems = validateSet(set, { root });
  if (problems.length > 0) throw new Error(`sizing set invalid:\n  ${problems.join('\n  ')}`);
  return set;
}
