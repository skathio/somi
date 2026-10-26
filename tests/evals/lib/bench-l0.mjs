// L0 footprint of the usage and speed benchmark: how many BYTES of instruction and context text reach a model
// for each scenario of a fixed list. Bytes only: no tokenizer, and no bytes-to-token ratio is assumed anywhere.
//
// A scenario is { id, components: [{ kind, name, ... }] }; its bytes are the sum of its components', and the
// result is { <id>: { bytes, components: [{ kind, name, bytes }] } } in scenario order.
//
// Component kinds and what is counted:
//   command  commands/<name>.md          the file as the host loads it
//   agent    agents/<name>.md            the file as the host loads it for a plugin agent
//   skill    skills/<name>/SKILL.md      the file as the skill load injects it
//   digest   rules/CLAUDE.md             the text between its digest markers (markers excluded)
//   hook     hooks/<event-dir>/<x>.mjs   the UTF-8 bytes of the additionalContext the hook prints when RUN with
//                                        the component's synthetic stdin payload in a fresh temp project
//                                        directory (optional `files`: relative path -> content to seed it).
//                                        A hook that prints nothing is a silent hook and counts 0 bytes.
//   tool     (supplied)                  a tool definition text handed in by the caller as data, because
//                                        reading it needs a live server and this lib imports only siblings.
//
// Frontmatter: by default (`frontmatter: 'include'`) the whole file counts. The host parses frontmatter itself,
// so the model may not see it, but the bytes are small and fixed, and counting the file keeps the figure an upper
// bound that needs no assumption about how a host strips it. `'strip'` removes the leading ---/--- block from
// command, agent and skill files (the shape the somi_agent fallback delivers) for a with/without comparison.
//
// Every refusal throws: an unreadable or missing component, an unknown kind, an unsafe name, a duplicate
// component in one scenario, a hook that fails, times out or prints something else than a hook result, an empty
// scenario. A component is never silently counted as zero.

import { execFile } from 'node:child_process';
import { lstatSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';

export const KINDS = ['command', 'agent', 'skill', 'digest', 'hook', 'tool'];
export const FRONTMATTER_MODES = ['include', 'strip'];
const SCENARIO_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const WORD = /^[a-z][a-z0-9-]{0,63}$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const HOOK_NAME = /^[a-z][a-z-]{0,31}\/[a-z][a-z0-9-]{0,63}\.mjs$/;
const FILE_KEYS = { command: ['kind', 'name'], agent: ['kind', 'name'], skill: ['kind', 'name'], digest: ['kind', 'name'],
  tool: ['kind', 'name'], hook: ['kind', 'name', 'event', 'payload', 'files'] };
const MAX_FILE = 2 * 1024 * 1024;
const HOOK_TIMEOUT_MS = 15000;
const HOOK_MAX_BUFFER = 4 * 1024 * 1024;
const DIGEST_START = '<!-- digest:start -->';
const DIGEST_END = '<!-- digest:end -->';

const fail = (msg) => { throw new Error(`l0: ${msg}`); };
const bytesOf = (text) => Buffer.byteLength(text, 'utf8');
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function readRegular(path, what) {
  let st;
  try { st = lstatSync(path); } catch { return fail(`${what} is missing or unreadable`); }
  if (!st.isFile()) fail(`${what} is not a regular file`);
  if (st.size > MAX_FILE) fail(`${what} is larger than ${MAX_FILE} bytes`);
  try { return readFileSync(path, 'utf8'); } catch { return fail(`${what} is unreadable`); }
}

export function stripFrontmatter(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

export function checkScenarios(list) {
  if (!Array.isArray(list) || list.length === 0) fail('the scenario list must be a non-empty array');
  const seen = new Set();
  for (const s of list) {
    if (!plain(s) || typeof s.id !== 'string' || !SCENARIO_ID.test(s.id)) fail('a scenario needs a valid id');
    if (seen.has(s.id)) fail(`duplicate scenario id ${s.id}`);
    seen.add(s.id);
    if (!Array.isArray(s.components) || s.components.length === 0) fail(`scenario ${s.id} has no components`);
    const keys = new Set();
    for (const c of s.components) {
      if (!plain(c) || !KINDS.includes(c.kind)) fail(`scenario ${s.id}: unknown component kind`);
      for (const k of Object.keys(c)) if (!FILE_KEYS[c.kind].includes(k)) fail(`scenario ${s.id}: unexpected key ${k} on a ${c.kind}`);
      const ok = c.kind === 'hook' ? HOOK_NAME.test(c.name) : c.kind === 'tool' ? TOOL_NAME.test(c.name)
        : c.kind === 'digest' ? c.name === 'rules/CLAUDE.md' : WORD.test(c.name);
      if (typeof c.name !== 'string' || !ok) fail(`scenario ${s.id}: invalid ${c.kind} name`);
      const key = `${c.kind}:${c.name}`;
      if (keys.has(key)) fail(`scenario ${s.id}: ${key} is listed twice`);
      keys.add(key);
      if (c.kind === 'hook') checkHook(c, s.id);
    }
  }
}

function checkHook(c, id) {
  if (typeof c.event !== 'string' || !/^[A-Za-z]{1,32}$/.test(c.event)) fail(`scenario ${id}: a hook needs an event`);
  if (c.payload !== undefined && !plain(c.payload)) fail(`scenario ${id}: a hook payload must be an object`);
  if (c.files === undefined) return;
  if (!plain(c.files)) fail(`scenario ${id}: hook files must be an object`);
  for (const [rel, content] of Object.entries(c.files)) {
    const parts = rel.split('/');
    if (typeof content !== 'string' || rel.startsWith('/') || parts.some((p) => p === '' || p === '..' || p === '.')) {
      fail(`scenario ${id}: unsafe hook file ${JSON.stringify(rel)}`);
    }
  }
}

function runNode(script, { cwd, env, input }) {
  return new Promise((res, rej) => {
    const child = execFile(process.execPath, [script], { cwd, env, timeout: HOOK_TIMEOUT_MS, maxBuffer: HOOK_MAX_BUFFER,
      encoding: 'utf8', windowsHide: true }, (err, stdout) => (err ? rej(err) : res(stdout)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// Runs one hook script from `repo` against a fresh temp project and returns the additionalContext byte count.
export async function hookBytes(repo, c) {
  const script = join(repo, 'hooks', c.name);
  readRegular(script, `hook ${c.name}`);
  const proj = mkdtempSync(join(tmpdir(), 'somi-l0-'));
  try {
    for (const [rel, content] of Object.entries(c.files ?? {})) {
      const target = resolve(proj, rel);
      if (!target.startsWith(proj + sep)) fail(`hook file ${rel} escapes the project`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    const env = { PATH: process.env.PATH ?? '', HOME: proj, TMPDIR: proj, LANG: 'C.UTF-8', TZ: 'UTC',
      CLAUDE_PROJECT_DIR: proj, CLAUDE_PLUGIN_ROOT: repo, SOMI_AUDIT_LOG: join(proj, 'audit.log') };
    let out;
    try {
      out = await runNode(script, { cwd: proj, env, input: JSON.stringify({ hook_event_name: c.event, ...(c.payload ?? {}) }) });
    } catch (e) {
      return fail(`hook ${c.name} failed (${e.killed ? 'timeout' : `exit ${e.code ?? 'error'}`})`);
    }
    if (out.trim() === '') return 0;
    let parsed;
    try { parsed = JSON.parse(out); } catch { return fail(`hook ${c.name} printed output that is not JSON`); }
    const ctx = parsed?.hookSpecificOutput?.additionalContext;
    if (typeof ctx !== 'string') return fail(`hook ${c.name} printed no additionalContext`);
    return bytesOf(ctx);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
}

function fileText(repo, c) {
  const rel = c.kind === 'skill' ? `skills/${c.name}/SKILL.md` : c.kind === 'digest' ? 'rules/CLAUDE.md' : `${c.kind}s/${c.name}.md`;
  return readRegular(join(repo, rel), `${c.kind} ${c.name}`);
}

async function componentBytes(repo, c, { frontmatter, tools }) {
  if (c.kind === 'hook') return hookBytes(repo, c);
  if (c.kind === 'tool') {
    const text = Object.hasOwn(tools, c.name) ? tools[c.name] : undefined;
    if (typeof text !== 'string' || text === '') fail(`tool ${c.name} was not supplied`);
    return bytesOf(text);
  }
  const text = fileText(repo, c);
  if (c.kind === 'digest') {
    const a = text.indexOf(DIGEST_START);
    const b = text.indexOf(DIGEST_END);
    if (a < 0 || b < a) fail('rules/CLAUDE.md has no digest markers');
    return bytesOf(text.slice(a + DIGEST_START.length, b));
  }
  return bytesOf(frontmatter === 'strip' ? stripFrontmatter(text) : text);
}

export async function measureL0({ repo, scenarios, tools = {}, frontmatter = 'include' }) {
  if (typeof repo !== 'string' || repo === '') fail('a repo directory is required');
  if (!FRONTMATTER_MODES.includes(frontmatter)) fail(`frontmatter must be one of ${FRONTMATTER_MODES.join(', ')}`);
  checkScenarios(scenarios);
  const root = resolve(repo);
  const out = {};
  for (const s of scenarios) {
    const components = [];
    for (const c of s.components) {
      components.push({ kind: c.kind, name: c.name, bytes: await componentBytes(root, c, { frontmatter, tools }) });
    }
    const bytes = components.reduce((t, c) => t + c.bytes, 0);
    if (bytes < 1) fail(`scenario ${s.id} measured zero bytes`);
    out[s.id] = { bytes, components };
  }
  return out;
}

// The baseline file's L0 section for a measurement.
export const l0Section = (result) => ({ bytes: Object.fromEntries(Object.entries(result).map(([id, r]) => [id, r.bytes])) });

export function formatTable(result) {
  const lines = [];
  for (const [id, r] of Object.entries(result)) {
    lines.push(`${id}  ${r.bytes} bytes`);
    for (const c of r.components) lines.push(`    ${String(c.bytes).padStart(8)}  ${c.kind} ${c.name}`);
  }
  return lines.join('\n');
}
