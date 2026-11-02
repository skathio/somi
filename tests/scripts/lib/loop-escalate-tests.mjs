#!/usr/bin/env node
// Tests of the code loop's escalation report (scripts/lib/loop-escalate.mjs and the rows it reads): throwaway git repos driven
// through the real step functions. Risk: a diff that warrants a lens comes out unreported, the report changes the review it
// only describes, a path leaves in the response or the diary, or a failure is skipped without saying so. Usage: node
// loop-escalate-tests.mjs; ESCALATE_LIB names another copy of scripts/lib, which tests/scripts/escalation.sh uses to run the
// suite on scratch mutants, and ESCALATE_ONLY=mutant-run:<check name> runs only the section holding that check (each mutant
// then costs one section, not all of them). Both hold only together, with that exact prefix, and only when the first argument names
// a file inside ESCALATE_LIB (the mutated file escalation.sh passes): variables exported by accident, alone or as a pair, redirect
// and skip nothing, so a run without that argument (loop-engine.sh's) is always the real library in full; a filter that matches no
// check fails the run. Hermetic: no model, no
// network; temp repos with a fixed author.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOMI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FILTER = 'mutant-run:';
const MUTANT = process.env.ESCALATE_LIB !== undefined && process.env.ESCALATE_ONLY?.startsWith(FILTER) && Boolean(process.argv[2]) && path.resolve(process.argv[2]).startsWith(path.resolve(process.env.ESCALATE_LIB) + path.sep);
const LIB = MUTANT ? process.env.ESCALATE_LIB : path.join(SOMI, 'scripts', 'lib');
const lib = (name) => import(pathToFileURL(path.join(LIB, name)).href);
const { runStep } = await lib('loop-step.mjs');
const { escalate, reported, diaryText } = await lib('loop-escalate.mjs');
const { LIMITS, guardedRows, ignoredSnapshot, treeNumstat, treeRows, measuredTree, unopened } = await lib('loop-review.mjs');
const { stateFile } = await lib('loop-state.mjs');

let pass = 0; let fail = 0;
const clip = (v) => JSON.stringify(v).slice(0, 200);
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${clip(want)}, got ${clip(got)})`); }
};
const tmp = mkdtempSync(path.join(tmpdir(), 'loop-escalate-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const ONLY = MUTANT ? process.env.ESCALATE_ONLY.slice(FILTER.length) : null;
const source = ONLY === null ? '' : readFileSync(fileURLToPath(import.meta.url), 'utf8');
// A section is a titled group of checks; with a filter, only the one whose source holds the named check runs.
const section = (title, body) => {
  if (ONLY !== null) {
    const at = source.indexOf(`section('${title}'`); const end = source.indexOf("\nsection('", at + 1);
    const text = source.slice(at, end < 0 ? undefined : end);
    if (!['check', 'lazy', 'perm'].some((f) => text.includes(`${f}('${ONLY}`))) return;
  }
  console.log(`== ${title} ==`); body();
};
// A check whose setup is costly is given as a thunk: with a filter, only the named one is computed.
const lazy = (name, got, want) => { if (ONLY === null || name.startsWith(ONLY)) check(name, got(), want); };
if (ONLY !== null) console.log(`  skip every section but the one holding "${ONLY}" (ESCALATE_ONLY=mutant-run:...)`);

const NOW = '2026-10-29T09:30:00Z';
const ROWS = '# Progress — p1\n\n## Iteration progress\n\n| Iteration | Title | Status | Reviewed | Last activity |\n|---|---|---|---|---|\n| 1.1 | one | not-started | — | — |\n';
const DIARY = '# Diary — p1\n\n> Spec: x\n\n---\n\n## 2026-10-28 10:00 — Plan\n\n**Category**: `note`\n**Phase**: 1\n\nbody\n\n---\n\n';
const lines = (n) => 'x\n'.repeat(n);
let n = 0;
// A repository whose project root is `sub` of its top level, with `files` committed beside a.js and b.js and a plan directory p1.
function repo({ sub = '', files = {} } = {}) {
  const top = path.join(tmp, `r${n++}`); const root = path.join(top, sub); mkdirSync(root, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', top, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim();
  const r = {
    top, root, git,
    put: (f, text) => { mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); writeFileSync(path.join(root, f), text); },
    ctx: (env = {}) => ({ root, env: { SOMI_GLOBAL_CONFIG: '', ...env }, stateDir: path.join(root, '.somi', 'somi-state', 'loop'), installRoot: SOMI, now: () => NOW, via: 'mcp' }),
    step: (args, env) => runStep(r.ctx(env), { slug: 'p1', iteration: '1.1', ...args }),
    open: () => r.step({ step: 'open', files: 'a.js src/ .claude/ .somi/ pkg/' }),
    after: (env) => r.step({ step: 'after-code', agent: 'somi-coder' }, env),
    diary: () => readFileSync(path.join(root, '.somi', 'plans', 'p1', 'diary.md'), 'utf8'),
  };
  git('init', '-q');
  const base = { 'a.js': '1\n', 'b.js': '1\n', ...files };
  for (const [f, t] of Object.entries(base)) r.put(f, t);
  git('add', '--', ...Object.keys(base).map((f) => path.join(sub, f))); git('commit', '-q', '-m', 'base');
  mkdirSync(path.join(root, '.somi', 'plans', 'p1', 'phases'), { recursive: true }); r.put('.somi/plans/p1/diary.md', DIARY); r.put('.somi/plans/p1/progress.md', ROWS);
  return r;
}
// The after-code response of a pass in which `edit` changed the tree.
const pass1 = (r, edit, env) => { r.open(); edit(r); return r.after(env); };

section('the report: what the loop says about its own diff, and what it leaves alone', () => {
  const clean = pass1(repo(), (r) => r.put('src/new.mjs', lines(40)));
  const auth = repo(); const a = pass1(auth, (r) => r.put('src/auth/zqmark.mjs', lines(10)));
  check('a clean 40-line new file has no escalation key; an auth file reports sensitive:auth and nothing else', [clean.exit, 'escalation' in clean, a.escalation],
    [0, false, { ran: true, reasons: ['sensitive:auth'], size_flag: false, tests_weakened: false, hard_surface: [] }]);
  check('the report changes no review: same mode and next step as the clean pass (and the absolute values), no review_min in the state', [a.review_mode, a.next, auth.step({ step: 'status' }).ok, JSON.parse(readFileSync(stateFile(auth.ctx().stateDir, 'p1', '1.1'), 'utf8')).review_min, clean.review_mode, clean.next],
    [clean.review_mode, clean.next, true, undefined, 'single', 'task-reviewer']);
  const big = pass1(repo(), (r) => r.put('src/big.mjs', lines(151)));
  check('151 production lines mark size_flag with no reason, no stop and the same review', [big.ok, big.exit, big.review_mode, big.escalation], [true, 0, 'single', { ran: true, reasons: [], size_flag: true, tests_weakened: false, hard_surface: [] }]);
  const env = pass1(repo({ files: { '.env': 'K=1\n' } }), (r) => rmSync(path.join(r.root, '.env')));
  check('a deleted .env reports deny_list as a reason and as a hard-surface id', [env.escalation.reasons, env.escalation.hard_surface], [['deny_list'], ['deny_list']]);
  const man = pass1(repo(), (r) => r.put('package.json', '{}\n'));
  check('a new package.json reports the manifest id and raises no reason', [man.escalation.reasons, man.escalation.hard_surface], [[], ['manifest']]);
  const twice = repo(); const first = pass1(twice, (r) => r.put('src/auth/zqmark.mjs', lines(10))); const second = twice.after();
  check('a repeated after-code measures again and reports the same escalation', [second.exit, second.escalation], [0, first.escalation]);
});

section('a failure says so: ran false, and the step still succeeds', () => {
  const r = repo(); r.open(); const head = r.git('rev-parse', 'HEAD'); writeFileSync(path.join(tmp, 'bad-global.json'), '{ not json');
  check('a config file that cannot be parsed gives {ran:false}: its own sensitive paths cannot be read, so nothing is reported as run', [escalate(r.root, { SOMI_GLOBAL_CONFIG: path.join(tmp, 'bad-global.json') }, [], head), escalate(r.root, { SOMI_GLOBAL_CONFIG: '' }, [], head).ran], [{ ran: false }, true]);
  check('a baseline that is not an object id, or that git cannot find, gives {ran:false}, never a throw', [escalate(r.root, { SOMI_GLOBAL_CONFIG: '' }, [], 'HEAD'), escalate(r.root, { SOMI_GLOBAL_CONFIG: '' }, [], 'f'.repeat(40))], [{ ran: false }, { ran: false }]);
  check('the report object is withheld when empty and says ran:false when it did not run', [reported({ ran: true, reasons: [], size_flag: false, tests_weakened: false, hard_surface: [], notes: [] }), reported({ ran: false })],
    [{}, { escalation: { ran: false } }]);
  r.put('.somi/config.json', '{"sizing":{"sensitive_paths":"x"}}\n');
  const refusedCfg = escalate(r.root, { SOMI_GLOBAL_CONFIG: '' }, [], head);
  check('the adapter\'s notes are reported as ids: a refused sizing key is named and raises', [refusedCfg.notes, refusedCfg.reasons], [['config_refused'], ['sensitive:config']]);
});

section('no path leaves: not in the response object, not in the diary line', () => {
  const r = repo(); const x = pass1(r, (q) => { q.put('src/auth/zqmark.mjs', lines(10)); q.put('src/zqother.mjs', lines(160)); });
  const out = r.step({ step: 'after-review', reviewers: ['somi-reviewer'], verdict: 'approve', blockers: 0, majors: 0 });
  const diaryLine = r.diary().split('\n').find((l) => l.includes('Blocker')) ?? '';
  check('the escalation object holds ids only: no name, no slash, no extension', [/zq|\/|\.mjs/.test(JSON.stringify(x.escalation)), x.escalation.reasons], [false, ['sensitive:auth']]);
  check('the pass\'s diary line names the ids and no file', [out.ok, diaryLine.includes('; escalation: sensitive:auth, size_flag'), /zq|\.mjs/.test(diaryLine)], [true, true, false]);
  check('the diary text reads stored state as untrusted: a path in a stored id is "unreadable", not copied', [diaryText({ ran: true, reasons: ['src/a.mjs'], hard_surface: [] }), diaryText({ ran: false }), diaryText(undefined)], ['; escalation unreadable', '; escalation did not run', '']);
});

section('rows: the status letter is added, the old rows are unchanged', () => {
  const r = repo(); r.put('a.js', '2\n3\n'); rmSync(path.join(r.root, 'b.js')); r.put('c.js', 'new\n');
  const head = r.git('rev-parse', 'HEAD'); const tree = measuredTree(r.root);
  check('treeRows carries git\'s letter per file (M, D, A)', treeRows(r.root, head, tree).map(({ file, status }) => [file, status]), [['a.js', 'M'], ['b.js', 'D'], ['c.js', 'A']]);
  check('treeNumstat answers the rows it always did: no status key', treeNumstat(r.root, head, tree), [{ added: 2, deleted: 1, file: 'a.js' }, { added: 0, deleted: 1, file: 'b.js' }, { added: 1, deleted: 0, file: 'c.js' }]);
});

section('the folders the measurement excludes are listed apart and added (agent policy)', () => {
  const reasons = (files, edit, sub) => (pass1(repo({ files, sub }), edit).escalation ?? {}).reasons ?? null;
  const CFG = ['sensitive:config'];
  lazy('a new .claude/settings.json (untracked) raises sensitive:config', () => reasons({}, (r) => r.put('.claude/settings.json', '{}\n')), CFG);
  lazy('a committed .claude/settings.json edited in place raises', () => reasons({ '.claude/settings.json': '{}\n' }, (r) => r.put('.claude/settings.json', '{"hooks":1}\n')), CFG);
  lazy('a hook moved out of .claude (delete plus add: the old path counts) raises', () => reasons({ '.claude/hooks/h.sh': 'echo\n' }, (r) => { rmSync(path.join(r.root, '.claude/hooks/h.sh')); r.put('scripts/h.sh', 'echo\n'); }), CFG);
  lazy('a staged rename inside .claude (git mv) raises sensitive:config, not an unreadable row', () => reasons({ '.claude/a.json': '{}\n' }, (r) => { r.git('mv', '.claude/a.json', '.claude/b.json'); }), CFG);
  lazy('a staged .claude file that is gone from the working tree raises', () => reasons({ '.claude/a.json': '{}\n' }, (r) => { r.git('rm', '-q', '--cached', '--', '.claude/a.json'); }), CFG);
  lazy('a new .mcp.json and a new .vscode/mcp.json (untracked, project MCP servers) each raise sensitive:config', () => [reasons({}, (r) => r.put('.mcp.json', '{}\n')), reasons({}, (r) => r.put('.vscode/mcp.json', '{}\n'))], [CFG, CFG]);
  // A submodule at .claude/hooks (the measurement exempts .claude, so it is reachable), compared in full whatever `ignore` says.
  const subRepo = (ignore, extra = {}) => {
    const src = path.join(tmp, `src${n++}`); mkdirSync(src);
    const sg = (...a) => execFileSync('git', ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
    sg('init', '-q'); writeFileSync(path.join(src, 'h.sh'), 'echo\n'); sg('add', '.'); sg('commit', '-q', '-m', 'hook');
    const r = repo();
    const add = (where) => r.git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', src, where);
    add('.claude/hooks'); if (extra.vendor) add('vendor/lib');
    if (ignore) r.git('config', '-f', '.gitmodules', 'submodule..claude/hooks.ignore', ignore);
    r.git('add', '.'); r.git('commit', '-q', '-m', 'submodule');
    return r;
  };
  const inSub = (r, ...a) => r.git('-C', '.claude/hooks', ...a);
  const subReasons = (r, edit) => (pass1(r, edit).escalation ?? {}).reasons ?? null;
  const moved = (r) => { writeFileSync(path.join(r.top, '.claude/hooks/h.sh'), 'changed\n'); inSub(r, 'commit', '-q', '-am', 'moved'); };
  lazy('a submodule at .claude/hooks with ignore = all and its HEAD moved raises sensitive:config', () => subReasons(subRepo('all'), moved), CFG);
  lazy('a submodule at .claude/hooks with ignore = dirty and a dirty file inside raises sensitive:config', () => subReasons(subRepo('dirty'), (r) => writeFileSync(path.join(r.top, '.claude/hooks/h.sh'), 'dirty\n')), CFG);
  lazy('an unchanged submodule at .claude/hooks still raises (it carries code the loop does not read)', () => subReasons(subRepo('all'), (r) => r.put('src/x.mjs', lines(3))), CFG);
  lazy('guardedRows: the diff lists a hidden moved submodule itself (M), and a gitlink outside the guarded paths is no row', () => {
    const r = subRepo('all', { vendor: true }); const head = r.git('rev-parse', 'HEAD'); moved(r);
    return guardedRows(r.root, head);
  }, [{ file: '.claude/hooks', added: 0, deleted: 0, status: 'M' }]);
  lazy('guardedRows: an unchanged gitlink under a guarded path is a G row', () => {
    const r = subRepo('all', { vendor: true }); return guardedRows(r.root, r.git('rev-parse', 'HEAD'));
  }, [{ file: '.claude/hooks', added: 0, deleted: 0, status: 'G' }]);
  lazy('a new .somi/config.json and a new .somi/rules/x.md each raise', () => [reasons({}, (r) => r.put('.somi/config.json', '{}\n')), reasons({}, (r) => r.put('.somi/rules/x.md', 'x\n'))], [CFG, CFG]);
  lazy('planning churn under .somi, and an ignored .claude/settings.local.json that is there at init and unchanged, raise nothing', () => {
    const r = repo({ files: { '.gitignore': '.claude/settings.local.json\n' } }); r.put('.claude/settings.local.json', '{}\n');
    return (pass1(r, (q) => q.put('.somi/plans/p1/notes.md', 'x\n')).escalation ?? {}).reasons ?? null;
  }, null);
  // the ignored files under the guarded paths are snapshotted at init, and one that is new or changed since raises.
  lazy('a self-ignoring .claude/.gitignore with a new .claude/agents/x.md raises sensitive:config', () => reasons({}, (r) => { r.put('.claude/.gitignore', '*\n'); r.put('.claude/agents/x.md', 'x\n'); }), CFG);
  lazy('an edit to an already-ignored .claude/settings.local.json after init raises', () => {
    const r = repo({ files: { '.gitignore': '.claude/settings.local.json\n' } }); r.put('.claude/settings.local.json', '{}\n');
    return (pass1(r, (q) => q.put('.claude/settings.local.json', '{"hooks":1}\n')).escalation ?? {}).reasons ?? null;
  }, CFG);
  lazy('a root .gitignore that adds .claude/x, then a new .claude/x, raises', () => reasons({}, (r) => { r.put('.gitignore', '.claude/x\n'); r.put('.claude/x', 'x\n'); }), CFG);
  lazy('an ignored build file outside the policy paths, new after init, raises nothing', () => reasons({ '.gitignore': '*.log\n' }, (r) => r.put('src/auth/x.log', 'x\n')), null);
  lazy('a new ignored file under .somi/rules raises', () => reasons({ '.gitignore': '.somi/rules/\n' }, (r) => r.put('.somi/rules/x.md', 'x\n')), CFG);
  const ignoredRepo = () => { const r = repo({ files: { '.gitignore': '.claude/s*\n' } }); r.put('.claude/s1', 'a\n'); symlinkSync('a', path.join(r.root, '.claude/s2')); return r; };
  lazy('an ignored link is hashed by its target: unchanged is no row, repointed is', () => {
    const r = ignoredRepo(); const head = r.git('rev-parse', 'HEAD'); const before = ignoredSnapshot(r.root); const rows = () => guardedRows(r.root, head, before).map((x) => [x.file, x.status]);
    const same = rows(); unlinkSync(path.join(r.root, '.claude/s2')); symlinkSync('b', path.join(r.root, '.claude/s2'));
    return [same, rows()];
  }, [[], [['.claude/s2', 'M']]]);
  lazy('a state without a snapshot (a loop begun before this snapshot existed) raises nothing for an ignored file', () => {
    const r = ignoredRepo(); return guardedRows(r.root, r.git('rev-parse', 'HEAD'));
  }, []);
  lazy('a snapshot that is over, or not of the stored shape, raises on every pass', () => {
    const r = ignoredRepo(); const head = r.git('rev-parse', 'HEAD'); const file = (b) => { try { return guardedRows(r.root, head, b).map((x) => x.file); } catch { return 'threw'; } };
    return [file({ over: true, files: {} }), file({ over: false, files: 5 }), file(null), file({ over: false, files: { '.claude/s1': 7 } }), file({ over: false, files: {}, digest: 5 })];
  }, [['.claude'], ['.claude'], ['.claude'], ['.claude'], ['.claude']]);
  // The snapshot of every ignored file the guard names: `setup` runs before it is taken, `edit` after; -> the rows [file, status], sorted.
  const HIDE = '*\n!.gitignore\n!a.js\n!b.js\n';
  const ignoredRows = (setup, edit, ignore = HIDE) => {
    const r = repo({ files: { '.gitignore': ignore } }); setup(r); const head = r.git('rev-parse', 'HEAD'); const before = ignoredSnapshot(r.root); edit(r);
    return guardedRows(r.root, head, before).map((x) => [x.file, x.status]).sort();
  };
  const none = () => {};
  const putAll = (r, names) => names.forEach((f) => r.put(f, 'x\n'));
  lazy('every guarded name, new and ignored, at any depth and in any case, is a row; a neighbouring name is not', () => ignoredRows(none, (r) => putAll(r,
    ['.vscode/mcp.json', '.mcp.json', 'src/CLAUDE.md', 'CLAUDE.local.md', 'docs/agents.md', 'pkg/.claude/x', '.CLAUDE/y', '.SOMI/Rules/r.md', '.somi/config.json', '.vscode/settings.json', 'mcp.json', 'src/x.js', 'docs/claude-notes.md', '.mcp.json.bak'])),
  ['.CLAUDE/y', '.mcp.json', '.SOMI/Rules/r.md', '.somi/config.json', '.vscode/mcp.json', 'CLAUDE.local.md', 'docs/agents.md', 'pkg/.claude/x', 'src/CLAUDE.md'].map((x) => [x, 'A']).sort());
  lazy('an ignored policy folder or rules folder that is itself a link is a row', () => ignoredRows(none, (r) => { mkdirSync(path.join(r.root, 'pkg')); symlinkSync('../x', path.join(r.root, '.somi/rules')); symlinkSync('../x', path.join(r.root, 'pkg/.claude')); }), [['.somi/rules', 'A'], ['pkg/.claude', 'A']]);
  lazy('a deleted ignored policy file is a D row', () => ignoredRows((r) => putAll(r, ['.somi/config.json', '.claude/settings.local.json', 'src/keep.js']), (r) => ['.somi/config.json', '.claude/settings.local.json', 'src/keep.js'].forEach((f) => unlinkSync(path.join(r.root, f)))),
    [['.claude/settings.local.json', 'D'], ['.somi/config.json', 'D']]);
  lazy('a file under a dependency folder is no row, nor is a policy file under one; a dependency folder inside a policy folder is', () => ignoredRows(none, (r) => putAll(r,
    ['node_modules/x/AGENTS.md', 'vendor/CLAUDE.md', 'bower_components/a/.mcp.json', '.venv/lib/CLAUDE.md', 'venv/b/agents.md', 'site-packages/c/CLAUDE.md', 'src/vendor/CLAUDE.local.md', '.claude/vendor/x.md', '.CLAUDE/vendor/x.md', 'foo.claude/vendor/CLAUDE.md', '.somi/rules/venv/y.md'])),
  [['.CLAUDE/vendor/x.md', 'A'], ['.claude/vendor/x.md', 'A'], ['.somi/rules/venv/y.md', 'A']]);
  lazy('a file over 1 MiB is read to its end and is not over', () => {
    const body = 'x'.repeat(1024 * 1024 + 7) + 'y'; const r = repo({ files: { '.gitignore': '.claude/big\n' } }); r.put('.claude/big', body);
    const now = ignoredSnapshot(r.root);
    return [now.over, now.files['.claude/big'] === createHash('sha256').update(body).digest('hex')];
  }, [false, true]);
  lazy('smoke check, a live checkout and no proof of the bound (the 1 MiB case above is): this repository\'s own snapshot is not over', () => ignoredSnapshot(SOMI).over, false);
  lazy('past 256 entries the snapshot is one digest: no row unchanged, one row for an edit, and one when the count crosses 256', () => {
    const many = (count) => (r) => { for (let i = 0; i < count; i++) r.put(`.claude/m/${i}`, 'x'); };
    const r = repo({ files: { '.gitignore': HIDE } }); many(257)(r); const snap = ignoredSnapshot(r.root); const exact = repo({ files: { '.gitignore': HIDE } }); many(256)(exact);
    return [typeof snap.digest, snap.over, Object.keys(snap.files).length, ignoredRows(many(257), none), ignoredRows(many(257), (q) => q.put('.claude/m/3', 'y')), ignoredRows(many(256), none), ignoredRows(many(256), many(258)), typeof ignoredSnapshot(exact.root).digest];
  }, ['string', false, 0, [], [['.claude', 'M']], [], [['.claude', 'M']], 'undefined']);
  lazy('past the byte bound a file is stood for by its size and change time: an edit is still a row', () => {
    const was = LIMITS.snapshotBytes; LIMITS.snapshotBytes = 100;
    try {
      const r = repo({ files: { '.gitignore': HIDE } }); r.put('.claude/a', 'a'.repeat(50)); r.put('.claude/b', 'b'.repeat(500)); const head = r.git('rev-parse', 'HEAD'); const before = ignoredSnapshot(r.root);
      const rows = () => guardedRows(r.root, head, before).map((x) => [x.file, x.status]); const same = rows(); r.put('.claude/b', 'c'.repeat(500));
      return [before.files['.claude/a'].length, before.files['.claude/b'].startsWith('s:'), same, rows()];
    } finally { LIMITS.snapshotBytes = was; }
  }, [64, true, [], [['.claude/b', 'M']]]);
  lazy('a worktree or nested repository under an ignored folder is a marker: a row only when it appears or goes', () => {
    const r = repo({ files: { '.gitignore': HIDE } }); const w = (n) => path.join('.claude', 'worktrees', n);
    r.git('worktree', 'add', '-q', '--detach', w('w1')); const head = r.git('rev-parse', 'HEAD'); const before = ignoredSnapshot(r.root);
    const rows = () => guardedRows(r.root, head, before).map((x) => [x.file, x.status]).sort();
    r.put(path.join(w('w1'), 'f.txt'), 'edited\n'); const inside = rows();
    r.git('worktree', 'add', '-q', '--detach', w('w2')); const added = rows();
    r.git('worktree', 'remove', '--force', w('w1'));
    return [before.over, inside, added, rows()];
  }, [false, [], [['.claude', 'A'], ['.claude/worktrees/w2', 'A']], [['.claude', 'A'], ['.claude/worktrees/w1', 'D'], ['.claude/worktrees/w2', 'A']]]);
  lazy('a nested repository made under an ignored .vscode, holding a new mcp.json, raises sensitive:config', () => reasons({ '.gitignore': '.vscode/\n' }, (r) => { execFileSync('git', ['init', '-q', path.join(r.root, '.vscode')]); r.put('.vscode/mcp.json', '{}\n'); }), CFG);
  lazy('at the byte bound exactly, the next file is stood for by its size and change time: a same-size edit is a row', () => {
    const was = LIMITS.snapshotBytes; LIMITS.snapshotBytes = 65536;
    try {
      const r = repo({ files: { '.gitignore': HIDE } }); r.put('.claude/a', 'a'.repeat(65536)); r.put('.claude/b', 'b'.repeat(500)); const head = r.git('rev-parse', 'HEAD'); const before = ignoredSnapshot(r.root);
      r.put('.claude/b', 'c'.repeat(500));
      return [before.files['.claude/a'].length, before.files['.claude/b'].startsWith('s:'), guardedRows(r.root, head, before).map((x) => [x.file, x.status])];
    } finally { LIMITS.snapshotBytes = was; }
  }, [64, true, [['.claude/b', 'M']]]);
  lazy('a link that loops, or runs through a file, is read as dangling', () => {
    const r = repo({ files: { '.gitignore': HIDE } }); r.put('tgt.txt', 'x\n'); mkdirSync(path.join(r.root, '.claude'));
    for (const [name, to] of [['loop', 'loop'], ['a', 'b'], ['b', 'a'], ['nd', '../tgt.txt/x']]) symlinkSync(to, path.join(r.root, '.claude', name));
    return Object.entries(ignoredSnapshot(r.root).files);
  }, [['.claude/a', 'l:b:dangling'], ['.claude/b', 'l:a:dangling'], ['.claude/loop', 'l:loop:dangling'], ['.claude/nd', 'l:../tgt.txt/x:dangling']]);
  // Root reads a mode 0 file and lists a mode 0311 folder, so the checks that rest on a permission are skipped for it (escalation.sh skips their mutants too).
  const ROOT_USER = process.getuid() === 0; const perm = (name, got, want) => (ROOT_USER ? console.log(`  skip ${name} (root ignores file modes)`) : lazy(name, got, want));
  perm('an entry that cannot be read is the over marker', () => {
    const locked = repo({ files: { '.gitignore': HIDE } }); locked.put('.claude/u', 'x\n'); chmodSync(path.join(locked.root, '.claude/u'), 0);
    return ignoredSnapshot(locked.root).over;
  }, true);
  // A folder made enterable but not listable (mode 0311): git warns on stderr, exits 0 and lists less than the tree holds.
  const shut = (r, dir) => chmodSync(path.join(r.root, dir), 0o311); const open = (r, dir) => chmodSync(path.join(r.root, dir), 0o755);
  perm('a policy folder git cannot list (mode 0311): the ignored snapshot is over, and the escalation does not run (the policy listing is refused)', () => {
    const snap = repo({ files: { '.gitignore': '.claude/\n' } }); snap.put('.claude/settings.local.json', '{}\n'); shut(snap, '.claude');
    const pass = repo(); pass.open(); pass.put('.claude/settings.local.json', '{}\n'); shut(pass, '.claude');
    const over = () => { try { return ignoredSnapshot(snap.root).over; } catch { return 'threw'; } };
    try { return [over(), pass.after().escalation]; } finally { open(snap, '.claude'); open(pass, '.claude'); }
  }, [true, { ran: false }]);
  perm('an untracked file in a folder git cannot list (mode 0311) is refused by the measured diff, never counted as nothing', () => {
    const r = repo(); r.open(); r.put('src/new.mjs', lines(3)); shut(r, 'src');
    const refusal = () => { try { measuredTree(r.root); return ['measured']; } catch (e) { return [e.code, /\.gitignore/.test(e.what)]; } };
    try { return [r.after().exit, ...refusal()]; } finally { open(r, 'src'); }
  }, [64, 64, true]);
  // A folder git cannot open that is not a policy folder is an entry of its own (u:<errno text>), compared like a nested repository.
  const lock = (r, dir) => chmodSync(path.join(r.root, dir), 0); const unlock = (rs) => rs.forEach((r) => { try { chmodSync(path.join(r.root, 'ign/sub'), 0o755); } catch { /* not locked */ } });
  const ignRepo = () => { const r = repo({ files: { '.gitignore': 'ign/\n' } }); r.put('ign/sub/f', 'x\n'); return r; };
  perm('an unreadable ignored folder outside the policy paths: there at init and unchanged it is no row and the loop runs, made unreadable after init it raises', () => {
    const early = ignRepo(); lock(early, 'ign/sub'); const before = ignoredSnapshot(early.root); early.put('src/x.js', lines(3));
    const rows = (r, b) => guardedRows(r.root, r.git('rev-parse', 'HEAD'), b).map((x) => [x.file, x.status]);
    const pass = ignRepo(); lock(pass, 'ign/sub'); const ran = pass1(pass, (q) => q.put('src/x.js', lines(3)));
    const late = ignRepo(); const lateBefore = ignoredSnapshot(late.root); lock(late, 'ign/sub');
    try { return [before.over, before.files['ign/sub'], rows(early, before), ran.exit, ran.escalation?.ran, ran.escalation?.reasons ?? null, rows(late, lateBefore)]; } finally { unlock([early, pass, late]); }
  }, [false, 'u:Permission denied', [], 0, undefined, null, [['ign/sub', 'A'], ['.claude', 'A']]]);
  perm('an unreadable ignored folder that goes (made listable) or whose reason changes after init raises', () => {
    const r = ignRepo(); lock(r, 'ign/sub'); const head = r.git('rev-parse', 'HEAD'); const before = ignoredSnapshot(r.root);
    const rows = () => guardedRows(r.root, head, before).map((x) => [x.file, x.status]);
    const forged = { over: false, files: { 'ign/sub': 'u:Not a directory' } };
    try { chmodSync(path.join(r.root, 'ign/sub'), 0o755); return [rows(), guardedRows(r.root, head, forged).map((x) => [x.file, x.status])]; } finally { unlock([r]); }
  }, [[['ign/sub', 'D'], ['.claude', 'A']], [['ign/sub', 'D'], ['.claude', 'A']]]);
  perm('a folder git cannot open that is, holds or lies under a policy name stays over, so a file planted in it later is not hidden (0311 .claude, .vscode, nested .claude, .somi/rules)', () => {
    const over = (ignore, dir, file) => {
      const r = repo({ files: { '.gitignore': ignore } }); r.put(file, 'x\n'); chmodSync(path.join(r.root, dir), 0o311);
      try { return [ignoredSnapshot(r.root).over, guardedRows(r.root, r.git('rev-parse', 'HEAD'), ignoredSnapshot(r.root)).map((x) => x.file)]; } finally { chmodSync(path.join(r.root, dir), 0o755); }
    };
    return [over('.claude/\n', '.claude', '.claude/a'), over('.vscode/\n', '.vscode', '.vscode/a'), over('pkg/\n', 'pkg/.claude', 'pkg/.claude/a'), over('.somi/rules/\n', '.somi/rules', '.somi/rules/a.md'), over('.claude/\n', '.claude/sub', '.claude/sub/a')];
  }, [[true, ['.claude']], [true, ['.claude']], [true, ['.claude']], [true, ['.claude']], [true, ['.claude']]]);
  perm('an unreadable ignored folder with the listing past 256 entries is stored in the digest with the others', () => {
    const r = repo({ files: { '.gitignore': 'ign/\n.claude/\n' } }); r.put('ign/sub/f', 'x\n'); for (let i = 0; i < 256; i++) r.put(`.claude/m/${i}`, 'x'); lock(r, 'ign/sub');
    try { return typeof ignoredSnapshot(r.root).digest; } finally { unlock([r]); }
  }, 'string');
  perm('a project root in a subfolder names its unreadable folder from the root, and a policy folder in it stays over', () => {
    const mk = (sub) => { const r = repo({ sub: 'pkg', files: { '.gitignore': 'ign/\n.claude/\n' } }); r.put(sub, 'x\n'); return r; };
    const a = mk('ign/sub/f'); chmodSync(path.join(a.root, 'ign/sub'), 0); const b = mk('.claude/f'); chmodSync(path.join(b.root, '.claude'), 0o311);
    try { return [{ ...ignoredSnapshot(a.root).files }, ignoredSnapshot(b.root).over]; } finally { chmodSync(path.join(a.root, 'ign/sub'), 0o755); chmodSync(path.join(b.root, '.claude'), 0o755); }
  }, [{ 'ign/sub': 'u:Permission denied' }, true]);
  lazy('only the git warning line is an unopened directory: another warning that holds the phrase (a file named like it, under a CRLF attribute) refuses nothing', () => {
    const r = repo(); r.put('.gitattributes', '* text eol=crlf\n'); r.put("could not open directory 'x': y", 'a\nb\n'); r.put('src/new.mjs', lines(3));
    let tree; try { tree = typeof measuredTree(r.root); } catch (e) { tree = `refused ${e.code}`; }
    return [tree, unopened("warning: in the working copy of 'could not open directory 'x': y', LF will be replaced by CRLF\n")];
  }, ['string', []]);
  lazy('the warning parser keeps the git lines, skips a directory that vanished (no such file or directory), and ignores anything else', () => unopened(
    "warning: could not open directory 'a/b/': Permission denied\nwarning: could not open directory 'gone/': No such file or directory\nnoise warning: could not open directory 'c/': Permission denied\nwarning: could not open directory 'd/': Not a directory\n"),
  [{ dir: 'a/b/', why: 'Permission denied' }, { dir: 'd/', why: 'Not a directory' }]);
  lazy('a link is hashed with its target when that is a regular file: an edit to the target, or a target created later, is a row', () => [
    ignoredRows((r) => { r.put('tgt.txt', 'a\n'); mkdirSync(path.join(r.root, '.claude')); symlinkSync('../tgt.txt', path.join(r.root, '.claude/s2')); }, (r) => appendFileSync(path.join(r.root, 'tgt.txt'), 'b\n')),
    ignoredRows((r) => { mkdirSync(path.join(r.root, '.claude')); symlinkSync('../later.txt', path.join(r.root, '.claude/s3')); }, (r) => r.put('later.txt', 'x\n')),
  ], [[['.claude/s2', 'M']], [['.claude/s3', 'M']]]);
  lazy('a link to a directory or to a FIFO is read as its text and does not wait', () => {
    const r = repo({ files: { '.gitignore': HIDE } }); r.put('src/x.js', 'x\n'); execFileSync('mkfifo', [path.join(r.root, 'pipe')]); mkdirSync(path.join(r.root, '.claude'));
    symlinkSync('../src', path.join(r.root, '.claude/ld')); symlinkSync('../pipe', path.join(r.root, '.claude/lf'));
    const url = pathToFileURL(path.join(LIB, 'loop-review.mjs')).href;
    try {
      const out = JSON.parse(execFileSync(process.execPath, ['-e', `import(${JSON.stringify(url)}).then((m) => console.log(JSON.stringify(m.ignoredSnapshot(${JSON.stringify(r.root)}))))`], { encoding: 'utf8', timeout: 10000 }));
      return [out.over, out.files['.claude/ld'], out.files['.claude/lf']];
    } catch { return 'hung or failed'; }
  }, [false, 'l:../src:special', 'l:../pipe:special']);
  lazy('in a pass: a new ignored .vscode/mcp.json, .mcp.json via .git/info/exclude and src/CLAUDE.md, and a deleted ignored .somi/config.json, each raise sensitive:config', () => {
    const run = (files, setup, edit) => { const r = repo({ files }); setup(r); return (pass1(r, edit).escalation ?? {}).reasons ?? null; };
    return [run({ '.gitignore': '.vscode/\nCLAUDE.md\n' }, none, (r) => r.put('.vscode/mcp.json', '{}\n')), run({}, (r) => writeFileSync(path.join(r.top, '.git/info/exclude'), '.mcp.json\n'), (r) => r.put('.mcp.json', '{}\n')),
      run({ '.gitignore': 'CLAUDE.md\n' }, none, (r) => r.put('src/CLAUDE.md', 'x\n')), run({ '.gitignore': '.somi/config.json\n' }, (r) => r.put('.somi/config.json', '{}\n'), (r) => rmSync(path.join(r.root, '.somi/config.json')))];
  }, [CFG, CFG, CFG, CFG]);
  // A gitlink exactly at .somi, or a nested repository there (.somi/.git), hides .somi/config.json and .somi/rules from every listing.
  const gitlink = (r) => r.git('update-index', '--add', '--cacheinfo', `160000,${r.git('rev-parse', 'HEAD')},.somi`);
  lazy('a gitlink exactly at .somi is a G row, and so is a nested repository at .somi', () => {
    const link = repo(); gitlink(link); const nested = repo(); nested.git('-C', '.somi', 'init', '-q');
    return [link, nested].map((r) => guardedRows(r.root, r.git('rev-parse', 'HEAD')).map((x) => [x.file, x.status]));
  }, [[['.somi', 'G']], [['.somi', 'G']]]);
  lazy('a gitlink at .somi inside a nested repository is one row, not two', () => {
    const r = repo(); gitlink(r); r.git('-C', '.somi', 'init', '-q'); return guardedRows(r.root, r.git('rev-parse', 'HEAD')).map((x) => [x.file, x.status]);
  }, [['.somi', 'G']]);
  lazy('a gitlink at .somi and a nested repository at .somi each raise sensitive:config in a pass', () => [
    reasons({}, (r) => gitlink(r)), reasons({}, (r) => r.git('-C', '.somi', 'init', '-q')),
  ], [CFG, CFG]);
  lazy('a project root in a subfolder of the repository: its own .somi/rules/x.md raises (new or edited), the same path above the root does not', () => [
    reasons({}, (r) => r.put('.somi/rules/x.md', 'x\n'), 'pkg'), reasons({ '.somi/rules/x.md': 'a\n' }, (r) => r.put('.somi/rules/x.md', 'b\n'), 'pkg'),
    reasons({}, (r) => { mkdirSync(path.join(r.top, '.somi', 'rules'), { recursive: true }); writeFileSync(path.join(r.top, '.somi', 'rules', 'x.md'), 'x\n'); }, 'pkg'),
  ], [CFG, CFG, null]);
});

section('no configured diff program or textconv driver runs during the read', () => {
  const drv = (r, name) => { const f = path.join(r.top, `${name}.sh`); writeFileSync(f, `#!/bin/sh\ntouch '${path.join(r.top, `RAN-${name}`)}'\ncat "$1"\n`); chmodSync(f, 0o755); return f; };
  const r = repo({ files: { '.gitattributes': '*.js diff=evil\n' } });
  r.git('config', 'diff.external', drv(r, 'ext')); r.git('config', 'diff.evil.textconv', drv(r, 'conv'));
  const x = pass1(r, (q) => { q.put('a.js', 'changed\n'); q.put('n.js', 'new\n'); });
  check('a repository-level diff.external and a textconv driver do not run, and the step succeeds', [x.exit, existsSync(path.join(r.top, 'RAN-ext')), existsSync(path.join(r.top, 'RAN-conv'))], [0, false, false]);
  // git's own trace names every command it runs (the pinned runner passes the caller's environment through): each diff carries both flags, whatever git's defaults are
  const trace = path.join(tmp, 'git-trace'); process.env.GIT_TRACE = trace;
  try { pass1(repo(), (q) => q.put('a.js', 'changed\n')); } finally { delete process.env.GIT_TRACE; }
  const diffs = readFileSync(trace, 'utf8').split('\n').filter((l) => / diff /.test(l) && /built-in: git/.test(l));
  check('every git diff the loop runs (the measurement, the review scope, the policy listing) passes --no-ext-diff and --no-textconv', [diffs.length >= 3, diffs.filter((l) => !(l.includes(' --no-ext-diff ') && l.includes(' --no-textconv '))).length], [true, 0]);
});

if (ONLY !== null && pass + fail === 0) { fail++; console.log('  FAIL no check matched the filter'); }
console.log(`SUMMARY ${pass + fail} ${fail}`);
process.exit(fail === 0 ? 0 : 1);
