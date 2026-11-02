// The surface stays small because a test says so. Raising a limit here is a deliberate decision, in plain sight in the diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from './helpers.mjs';

const list = (dir) => fs.readdirSync(path.join(REPO, dir));
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const FLOW_FILES = [...list('commands').map((f) => `commands/${f}`), ...list('agents').map((f) => `agents/${f}`), 'rules/digest.md'];

test('five commands', () => assert.deepEqual(list('commands').sort(), ['plan.md', 'review.md', 'ship.md', 'status.md', 'task.md']));
test('three agents', () => assert.deepEqual(list('agents').sort(), ['somi-coder.md', 'somi-reviewer.md', 'somi-security-reviewer.md']));
test('at most ten skills, none of them a flow or a role', () => {
  const skills = list('skills');
  assert.ok(skills.length <= 10, `${skills.length} skills`);
  assert.deepEqual(skills.filter((s) => /^(flow|role)-/.test(s)), []);
});
test('the digest is at most 150 lines', () => {
  const lines = read('rules/digest.md').split('\n').length;
  assert.ok(lines <= 150, `${lines} lines`);
});

test('flow text never asks a model to edit a state file', () => {
  const EDIT = /\b(edit|update|write|append|create|modify|tick|add)\b[^.\n]{0,60}(\.somi\/|progress\.md|diary\.md|decisions\.md|state\.json|journal\.jsonl)/i;
  for (const f of FLOW_FILES) assert.doesNotMatch(read(f), EDIT, f);
});

test('the reviewers cannot write', () => {
  for (const f of ['agents/somi-reviewer.md', 'agents/somi-security-reviewer.md']) assert.match(read(f), /^disallowedTools: Write, Edit, MultiEdit, NotebookEdit$/m, f);
});

test('every hook registered on Claude Code exists', () => {
  const commands = Object.values(json('hooks/hooks.json').hooks).flat().flatMap((e) => e.hooks).map((h) => h.command);
  assert.ok(commands.length >= 6);
  for (const c of commands) assert.ok(fs.existsSync(path.join(REPO, c.split('${CLAUDE_PLUGIN_ROOT}/')[1])), c);
});

test('version files agree', () => {
  const version = read('VERSION').trim();
  for (const f of ['package.json', '.claude-plugin/plugin.json', '.copilot-extension/extension.json']) assert.equal(json(f).version, version, f);
  assert.equal(json('package-lock.json').version, version);
  for (const p of json('.claude-plugin/marketplace.json').plugins) assert.equal(p.version, version);
  for (const p of json('.copilot-extension/marketplace.json').extensions) assert.equal(p.version, version);
});

test('the package ships what the plugin needs and no tests or benchmarks', () => {
  const { files } = json('package.json');
  for (const f of ['commands/', 'agents/', 'skills/', 'rules/', 'hooks/', 'scripts/', 'profiles/']) assert.ok(files.includes(f), f);
  assert.equal(files.includes('tests/'), false);
  assert.equal(files.includes('benchmarks/'), false);
  assert.ok(fs.existsSync(path.join(REPO, json('package.json').bin.somi)));
});

test('no runtime dependencies', () => assert.equal(json('package.json').dependencies, undefined));

test('every test the check plan names exists, and every code module is mapped', () => {
  const plan = json('somi.check.json');
  for (const t of [...plan.always, ...Object.values(plan.map).flat()]) assert.ok(fs.existsSync(path.join(REPO, t)), t);
  for (const f of list('scripts/lib')) assert.ok(plan.map[`scripts/lib/${f}`], `scripts/lib/${f} is not in somi.check.json`);
});

test('the overview page roadmap covers every release in the changelog, once', () => {
  const released = [...read('CHANGELOG.md').matchAll(/^## \[(\d+\.\d+\.\d+)\] — /gm)].map((m) => m[1]).sort();
  const covered = json('site/src/content/roadmap.json').eras.flatMap((e) => e.entries.flatMap((x) => x.covers)).sort();
  assert.deepEqual(covered, released);
});

test('frontmatter and links are sound', () => {
  for (const script of ['check-frontmatter.mjs', 'check-links.mjs']) {
    const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', script)], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, `${script}: ${r.stdout}${r.stderr}`);
  }
});
