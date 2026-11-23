// The brief /somi-brief prepares: a file only the CLI writes, refused when it is not ready, and the work /somi-deliver builds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { makeRepo, somi } from './helpers.mjs';
import { advise } from '../scripts/lib/advisor.mjs';
import { MAX_REQUIREMENTS, closeBrief, parseBrief, readBrief, saveBrief } from '../scripts/lib/brief.mjs';
import { addToLedger, readLedger, MAX_LINES } from '../scripts/lib/ledger.mjs';
import { savePrompt } from '../scripts/lib/prompt.mjs';
import { briefArgs } from '../scripts/lib/brief-route.mjs';

const env = { ...process.env, SOMI_GLOBAL_CONFIG: '' };
const makeCtx = (dir, config = {}) => ({ root: dir, env, config, configLayers: [config], host: 'claude', now: () => '2026-01-02T00:00:00Z' });
const MODELS = { tiers: { claude: { low: 'cheap', medium: 'everyday', high: 'strong' } } };

const brief = ({ requirements = ['Export returns CSV.', 'A missing customer answers 400.'], handoff = 'deliver, it spans two modules', extra = '' } = {}) => [
  '# Brief: Export orders',
  '## Goal',
  'Let support download orders.',
  '## Requirements',
  ...requirements.map((r, i) => `${i + 1}. ${r}`),
  '## Decisions',
  '- Dates are ISO 8601 in UTC.',
  '## Out of scope',
  '- Excel export.',
  '## Conventions',
  '- "errors are { error: code }" (docs/API.md)',
  '## Acceptance',
  '- npm test passes',
  '## Boundaries',
  '- the customer id reaches a query',
  '## Context',
  '- Files: src/orders.js, `src/routes.js`',
  '- Tests: `npm test`',
  '- Size: about 200 lines',
  extra,
  '## Handoff',
  handoff,
].join('\n');

test('a brief reads into its parts, with the context a builder would otherwise scout for', () => {
  const b = parseBrief(brief());
  assert.equal(b.title, 'Export orders');
  assert.deepEqual(b.requirements, ['Export returns CSV.', 'A missing customer answers 400.']);
  assert.deepEqual(b.files, ['src/orders.js', 'src/routes.js']);
  assert.equal(b.test_command, 'npm test');
  assert.equal(b.handoff, 'deliver');
  assert.equal(b.handoff_why, 'it spans two modules');
  assert.deepEqual(b.out_of_scope, ['Excel export.']);
});

test('a brief that leaves out its title, goal, requirements or handoff is refused, and says what is missing', () => {
  assert.throws(() => parseBrief(brief().replace('# Brief: Export orders\n', '')), /starts with a "# Brief: <title>" line/);
  assert.throws(() => parseBrief(brief().replace('Let support download orders.\n', '')), /needs a ## Goal/);
  assert.throws(() => parseBrief(brief({ requirements: [] })), /at least one requirement/);
  assert.throws(() => parseBrief(brief({ handoff: '' })), /## Handoff starts with deliver or somi/);
  assert.throws(() => parseBrief(brief({ handoff: 'later' })), /## Handoff starts with deliver or somi/);
});

test('requirements are numbered in order, one per line, so the stages can cite them by number', () => {
  assert.throws(() => parseBrief(brief().replace('2. A missing', '3. A missing')), /number 2 reads 3/);
  assert.throws(() => parseBrief(brief().replace('2. A missing customer answers 400.', '2. A missing customer\n   answers 400.')), /every line under ## Requirements is one numbered requirement/);
  assert.throws(() => parseBrief(brief({ extra: '## Notes\n- x' })), /no section "Notes"/);
  assert.throws(() => parseBrief(brief({ extra: '## Requirements\n1. something else' })), /one ## requirements section; merge the two/);
});

test('a brief holds at most its limit of requirements, each at most 600 characters', () => {
  assert.equal(parseBrief(brief({ requirements: Array.from({ length: MAX_REQUIREMENTS }, (_, i) => `R${i}.`) })).requirements.length, MAX_REQUIREMENTS);
  assert.throws(() => parseBrief(brief({ requirements: Array.from({ length: MAX_REQUIREMENTS + 1 }, (_, i) => `R${i}.`) })), /at most 40 requirements/);
  assert.equal(parseBrief(brief({ requirements: ['x'.repeat(600)] })).requirements[0].length, 600);
  assert.throws(() => parseBrief(brief({ requirements: ['x'.repeat(601)] })), /over 600 characters/);
  assert.throws(() => parseBrief(`${brief()}\n${'\n'.repeat(200)}`), /limited to 200 lines/);
});

test('a brief that still lists open questions is not ready, and one that says none is', () => {
  assert.throws(() => parseBrief(brief({ extra: '## Open questions\n- which store?' })), /1 open question\(s\) is not ready to hand off; settle them with the user first/);
  assert.equal(parseBrief(brief({ extra: '## Open questions\n- None' })).title, 'Export orders');
});

test('saving puts its decisions in the ledger; a full ledger keeps the brief and names what did not fit', (t) => {
  const dir = makeRepo(t);
  const saved = saveBrief(dir, brief(), env);
  assert.deepEqual(saved, { saved: path.join('.somi', 'brief.md'), title: 'Export orders', requirements: 2, handoff: 'deliver' });
  assert.match(readLedger(dir, env), /- decision: Dates are ISO 8601 in UTC\./);
  const full = makeRepo(t);
  for (let i = 0; i < MAX_LINES; i++) addToLedger(full, { kind: 'constraint', text: `c${i}` }, env);
  assert.deepEqual(saveBrief(full, brief(), env).unrecorded, ['Dates are ISO 8601 in UTC.']);
  assert.equal(readBrief(full).title, 'Export orders');
});

test('a brief refused on save leaves nothing behind, and one written through a link is refused', (t) => {
  const dir = makeRepo(t);
  assert.throws(() => saveBrief(dir, brief({ requirements: [] }), env), /at least one requirement/);
  assert.equal(readBrief(dir), null);
  fs.mkdirSync(path.join(dir, '.somi'));
  fs.symlinkSync(path.join(dir, 'elsewhere.md'), path.join(dir, '.somi', 'brief.md'));
  assert.throws(() => saveBrief(dir, brief(), env), /refusing to write through a link/);
  assert.equal(fs.existsSync(path.join(dir, 'elsewhere.md')), false);
});

test('a brief that replaces another drops the old one\'s decisions from the ledger and keeps other entries', (t) => {
  const dir = makeRepo(t);
  addToLedger(dir, { kind: 'constraint', text: 'no new dependencies' }, env);
  saveBrief(dir, brief(), env);
  saveBrief(dir, brief().replace('Dates are ISO 8601 in UTC.', 'Dates are epoch seconds.'), env);
  assert.equal(readLedger(dir, env), '- constraint: no new dependencies\n- decision: Dates are epoch seconds.');
});

test('closing a brief takes out its own decisions and keeps every other note; with no brief open it changes nothing', (t) => {
  const dir = makeRepo(t);
  addToLedger(dir, { kind: 'constraint', text: 'keep v1' }, env);
  assert.equal(closeBrief(dir, env).closed, false);
  saveBrief(dir, brief(), env);
  assert.deepEqual(closeBrief(dir, env), { closed: true });
  assert.equal(readBrief(dir), null);
  assert.equal(readLedger(dir, env), '- constraint: keep v1');
});

test('a brief the repository commits is never built from, and its text is not handed on', (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n', '.somi/brief.md': brief().replace('- Tests: `npm test`', '- Tests: `echo repo-chosen`') });
  const open = readBrief(dir);
  assert.match(open.invalid, /committed to this repository.*git rm --cached/);
  assert.equal(open.text, undefined);
  savePrompt(dir, '/somi-deliver', env);
  const r = advise(makeCtx(dir, MODELS), { staged: true });
  assert.equal(r.workflow, undefined);
  assert.doesNotMatch(JSON.stringify(r), /repo-chosen/);
  assert.equal(somi(dir, ['brief', '--show']).json.text, undefined);
});

test('a brief file over the size limit is not read, and is reported as not a brief', (t) => {
  const dir = makeRepo(t);
  fs.mkdirSync(path.join(dir, '.somi'));
  fs.writeFileSync(path.join(dir, '.somi', 'brief.md'), `# Brief: big\n${'x'.repeat(16384)}`);
  assert.match(readBrief(dir).invalid, /a brief starts with a "# Brief: <title>" line/);
});

test('the brief route runs in the conversation, even when the conversation is on a lower tier', (t) => {
  const r = advise(makeCtx(makeRepo(t), { tiers: { main: 'low' } }), { request: 'Prepare CSV export', hint: 'brief' });
  assert.equal(r.route, 'brief');
  assert.equal(r.where, 'here');
  assert.deepEqual(r.steps.map((s) => [s.step, s.run_on]), [['brief', 'main']]);
  assert.match(r.role, /Change no code/);
  assert.match(r.role, /# Brief: <short title>/);
});

test('a bare /somi-deliver with a brief open starts the workflow on the brief\'s requirements and facts', (t) => {
  const dir = makeRepo(t);
  const ctx = makeCtx(dir, MODELS);
  saveBrief(dir, brief(), env);
  savePrompt(dir, '/somi-deliver', env);
  const r = advise(ctx, {});
  assert.equal(r.workflow.name, 'somi:deliver-stages');
  assert.equal(r.workflow.args.request, 'Export returns CSV.\nA missing customer answers 400.');
  assert.equal(r.workflow.args.said, undefined, 'a bare command adds no words of the user\'s');
  assert.deepEqual([r.workflow.args.brief.files, r.workflow.args.brief.tests], [['src/orders.js', 'src/routes.js'], ['npm test']]);
  assert.deepEqual(r.workflow.args.brief.goal, ['Let support download orders.']);
  assert.deepEqual(r.workflow.args.brief.boundaries, ['the customer id reaches a query']);
  assert.match(r.workflow.args.ledger, /ISO 8601/);
  assert.match(r.brief_advice, /is the work.*close the brief with somi_brief/);
  assert.equal(advise(ctx, { request: 'Fix the open finding in src/orders.js' }).workflow, undefined, 'a later call in the same turn is new work');
});

test('words typed after /somi-deliver are the work, never a brief left open; staged true with no request builds the brief', (t) => {
  const dir = makeRepo(t);
  saveBrief(dir, brief(), env);
  savePrompt(dir, '/somi-deliver add rate limiting', env);
  const r = advise(makeCtx(dir, MODELS), {});
  assert.equal(r.workflow.args.request, 'add rate limiting');
  assert.equal(r.workflow.args.brief, undefined);
  assert.match(r.brief_advice, /this run builds the user's words, not the brief/);
  savePrompt(dir, 'go', env);
  assert.equal(advise(makeCtx(dir, MODELS), { staged: true }).workflow.args.request, 'Export returns CSV.\nA missing customer answers 400.');
  assert.equal(advise(makeCtx(dir, MODELS), { staged: false }).workflow, undefined);
});

test('a bare /somi-deliver routed with a non-build hint keeps its own request, and a cloned brief reaches an answer capped', (t) => {
  const dir = makeRepo(t);
  saveBrief(dir, brief().replace('# Brief: Export orders', `# Brief: ${'x'.repeat(5000)}`), env);
  savePrompt(dir, '/somi-deliver', env);
  const r = advise(makeCtx(dir, MODELS), { request: 'Weigh the export options', hint: 'design' });
  assert.equal(r.route, 'design');
  assert.equal(r.workflow, undefined);
  assert.doesNotMatch(r.brief_advice, /the workflow builds/);
  assert.ok(r.brief_advice.length < 1000, `${r.brief_advice.length} characters`);
});

test('without a brief, a bare /somi-deliver is still not a request', (t) => {
  const dir = makeRepo(t);
  savePrompt(dir, '/somi-deliver', env);
  assert.equal(advise(makeCtx(dir, MODELS), {}).workflow, undefined);
});

test('plain SoMi is told a brief is open, and offered /somi-deliver only when its handoff says deliver', (t) => {
  const dir = makeRepo(t);
  saveBrief(dir, brief(), env);
  const r = advise(makeCtx(dir), { request: 'Add a helper' });
  assert.equal(r.workflow, undefined);
  assert.deepEqual(r.brief, { path: '.somi/brief.md', title: 'Export orders', requirements: 2, handoff: 'deliver' });
  assert.match(r.brief_advice, /build every numbered requirement.*If this request is other work, leave the brief alone\. Its handoff is deliver/);
  saveBrief(dir, brief({ handoff: 'somi' }), env);
  assert.doesNotMatch(advise(makeCtx(dir), { request: 'Add a helper' }).brief_advice, /somi-deliver/);
  assert.match(advise(makeCtx(dir), { request: 'x', hint: 'brief' }).brief_advice, /already open.*refines it or replaces it/);
});

test('a brief on disk that no longer reads is named and never built from', (t) => {
  const dir = makeRepo(t);
  saveBrief(dir, brief(), env);
  fs.writeFileSync(path.join(dir, '.somi', 'brief.md'), '# Brief: x\n');
  savePrompt(dir, '/somi-deliver', env);
  const r = advise(makeCtx(dir, MODELS), {});
  assert.equal(r.workflow, undefined);
  assert.match(r.brief.invalid, /needs a ## Goal/);
  assert.match(r.brief_advice, /Do not build from it/);
});

test('the CLI saves, shows and closes a brief, refuses one that is not ready, and status names it', (t) => {
  const dir = makeRepo(t);
  assert.equal(somi(dir, ['brief'], { input: brief({ requirements: [] }) }).status, 64);
  assert.equal(somi(dir, ['brief'], { input: brief() }).json.requirements, 2);
  assert.match(somi(dir, ['brief', '--show']).json.text, /# Brief: Export orders/);
  assert.match(somi(dir, ['status']).stdout, /Brief: Export orders \(2 requirements, hand off to deliver\)/);
  assert.equal(somi(dir, ['brief', '--close']).json.closed, true);
  assert.equal(somi(dir, ['brief', '--show']).json.brief, null);
});

test('the workflow gets every brief field as a list, None boundaries dropped, and nothing that stands in for the scout', () => {
  const b = parseBrief(brief().replace('- the customer id reaches a query', '- None'));
  const args = briefArgs(b);
  assert.deepEqual([args.title, args.size, args.boundaries, args.known], [['Export orders'], ['about 200 lines'], undefined, undefined]);
  assert.equal(briefArgs(parseBrief(brief().replace('- Tests: `npm test`\n', ''))).tests, undefined);
});

test('a .somi committed as a submodule is refused, while a committed project config alone is not', (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n', '.somi/config.json': '{}\n' });
  saveBrief(dir, brief(), env);
  assert.equal(readBrief(dir).title, 'Export orders', 'a committed .somi/config.json does not make the brief foreign');
  const cloned = makeRepo(t);
  saveBrief(cloned, brief(), env);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: makeRepo(t), encoding: 'utf8' }).trim();
  execFileSync('git', ['update-index', '--add', '--cacheinfo', `160000,${head},.somi`], { cwd: cloned });
  assert.match(readBrief(cloned).invalid, /\.somi itself, is committed/);
  assert.equal(closeBrief(cloned, env).closed, false);
  assert.equal(fs.existsSync(path.join(cloned, '.somi', 'brief.md')), true);
});

test('a .somi folder that is a link to the repository\'s own files is never read as a brief, written through or deleted through', (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n', 'docs/x/brief.md': brief().replace('- Tests: `npm test`', '- Tests: `node chosen.js`') });
  fs.symlinkSync('docs/x', path.join(dir, '.somi'));
  assert.match(readBrief(dir).invalid, /\.somi is a link/);
  assert.doesNotMatch(JSON.stringify(advise(makeCtx(dir, MODELS), { staged: true })), /chosen\.js/);
  assert.throws(() => saveBrief(dir, brief(), env), /cannot be saved here: \.somi is a link/);
  assert.equal(closeBrief(dir, env).closed, false);
  assert.equal(fs.existsSync(path.join(dir, 'docs/x/brief.md')), true, 'the repository\'s file is not deleted');
});

test('a committed brief, in any letter case, is refused on save and never deleted by a close', (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n', '.somi/BRIEF.md': brief() });
  fs.renameSync(path.join(dir, '.somi', 'BRIEF.md'), path.join(dir, '.somi', 'brief.md'));
  assert.throws(() => saveBrief(dir, brief(), env), /committed to this repository/);
  assert.equal(closeBrief(dir, env).closed, false);
  assert.equal(fs.existsSync(path.join(dir, '.somi', 'brief.md')), true);
});
