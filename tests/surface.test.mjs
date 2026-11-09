// What a host lists must stay small, because hosts silently drop descriptions past a budget and an unlisted tool is not picked. The
// library behind the tools has no limit. Raising a limit here is a deliberate decision, in plain sight in the diff.
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

const description = (text) => /^description: "?(.*?)"?$/m.exec(text)?.[1] ?? '';
// Copilot lists every command as a skill, whether or not the model may start it, so every one counts.
const listedCommands = () => list('commands');
const workflowDescription = (f) => /description: '([^']*)'/.exec(read(`workflows/${f}`))?.[1] ?? '';
const listed = () => [...listedCommands().map((f) => [f.replace('.md', ''), description(read(`commands/${f}`))]), ...list('skills').map((s) => [s, description(read(`skills/${s}/SKILL.md`))]), ...list('workflows').map((f) => [f.replace('.js', ''), workflowDescription(f)])];

test('a host lists at most 15 entries and 8,000 characters', () => {
  assert.ok(listed().length <= 15, `${listed().length} entries`);
  const chars = listed().reduce((n, [name, d]) => n + name.length + d.length, 0) + list('agents').reduce((n, f) => n + description(read(`agents/${f}`)).length, 0);
  assert.ok(chars <= 8000, `${chars} characters`);
  for (const [name, d] of listed()) assert.ok(d.length > 0 && d.length <= 200, `${name}: ${d.length} characters`);
});
test('the main agent, three workers and two reviewers, and shared files name no tools and no models', () => {
  assert.deepEqual(list('agents').sort(), ['somi-reviewer.md', 'somi-security-reviewer.md', 'somi-worker-high.md', 'somi-worker-low.md', 'somi-worker-medium.md', 'somi.md']);
  const body = (t) => read(`agents/somi-worker-${t}.md`).replace(/^---[\s\S]*?---\n/, '');
  assert.equal(body('low'), body('medium'));
  assert.equal(body('low'), body('high'));
  for (const f of [...list('agents').map((a) => `agents/${a}`), ...list('commands').map((c) => `commands/${c}`), ...list('skills').map((s) => `skills/${s}/SKILL.md`)]) {
    const front = /^---\n([\s\S]*?)\n---/.exec(read(f))[1];
    assert.doesNotMatch(front, /^(tools|disallowedTools|model):/m, f);
  }
});
test('expertise stays behind the tools, focused and free of version templates', () => {
  assert.deepEqual(list('skills'), ['somi-expertise']);
  for (const f of list('library/skills')) assert.ok(read(`library/skills/${f}`).split('\n').length < 100, f);
});
test('a few commands, each prefixed so no host\'s own command hides it, and the Copilot manifest lists exactly them', () => {
  assert.deepEqual(listedCommands().sort(), ['somi-config.md', 'somi-deliver.md', 'somi-quality.md', 'somi-review.md', 'somi-status.md', 'somi.md']);
  assert.deepEqual(json('.copilot-extension/extension.json').commands.map((c) => c.name).sort(), listedCommands().map((f) => f.replace('.md', '')).sort());
});
test('the digest is at most 150 lines', () => {
  const lines = read('rules/digest.md').split('\n').length;
  assert.ok(lines <= 150, `${lines} lines`);
});

test('flow text never asks a model to edit a state file', () => {
  const EDIT = /\b(edit|update|write|append|create|modify|tick|add)\b[^.\n]{0,60}(\.somi\/|progress\.md|diary\.md|decisions\.md|state\.json|journal\.jsonl)/i;
  for (const f of FLOW_FILES) assert.doesNotMatch(read(f), EDIT, f);
});

test('every hook registered on Claude Code exists', () => {
  const commands = Object.values(json('hooks/hooks.json').hooks).flat().flatMap((e) => e.hooks).map((h) => h.command);
  assert.ok(commands.length >= 6);
  for (const c of commands) assert.ok(fs.existsSync(path.join(REPO, c.split('${CLAUDE_PLUGIN_ROOT}/')[1])), c);
});

test('the write guards are registered for every file-writing tool', () => {
  const entries = json('hooks/hooks.json').hooks.PreToolUse;
  for (const guard of ['block-secret-writes', 'guard-protected-paths']) {
    const entry = entries.find((e) => e.hooks.some((h) => h.command.includes(`/${guard}.mjs`)));
    for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) assert.ok(entry.matcher.split('|').includes(tool), `${guard} misses ${tool}`);
  }
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
  for (const f of ['commands/', 'agents/', 'skills/', 'workflows/', 'library/', 'rules/', 'hooks/', 'scripts/', 'profiles/']) assert.ok(files.includes(f), f);
  assert.equal(files.includes('tests/'), false);
  assert.equal(files.includes('benchmarks/'), false);
  assert.ok(fs.existsSync(path.join(REPO, json('package.json').bin.somi)));
});

test('no runtime dependencies', () => assert.equal(json('package.json').dependencies, undefined));

test('every test the check plan names exists, and every code module is mapped', () => {
  const plan = json('somi.check.json');
  for (const t of [...plan.always, ...Object.values(plan.map).flat()]) assert.ok(fs.existsSync(path.join(REPO, t)), t);
  // A folder of modules is checked file by file, so none inside it goes unmapped.
  const modules = list('scripts/lib').flatMap((f) => (fs.statSync(path.join(REPO, 'scripts/lib', f)).isDirectory() ? list(`scripts/lib/${f}`).map((g) => `${f}/${g}`) : [f]));
  for (const f of modules) assert.ok(plan.map[`scripts/lib/${f}`], `scripts/lib/${f} is not in somi.check.json`);
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
