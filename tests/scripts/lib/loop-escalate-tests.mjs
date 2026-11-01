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

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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
const { guardedRows, ignoredSnapshot, treeNumstat, treeRows, measuredTree } = await lib('loop-review.mjs');
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
    if (!['check', 'lazy'].some((f) => text.includes(`${f}('${ONLY}`))) return;
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
    return [file({ over: true, files: {} }), file({ over: false, files: 5 }), file(null), file({ over: false, files: { '.claude/s1': 7 } })];
  }, [['.claude'], ['.claude'], ['.claude'], ['.claude']]);
  lazy('257 ignored files under .claude, or one over 1 MiB, are the over marker; 256 files, or one of 1 MiB, are not', () => {
    const many = (count) => { const r = repo({ files: { '.gitignore': '.claude/m/\n' } }); for (let i = 0; i < count; i++) r.put(`.claude/m/${i}`, 'x'); return r; };
    const big = repo({ files: { '.gitignore': '.claude/big\n' } }); big.put('.claude/big', 'x'.repeat(1024 * 1024 + 1));
    const ok = repo({ files: { '.gitignore': '.claude/big\n' } }); ok.put('.claude/big', 'x'.repeat(1024 * 1024));
    return [many(257), big, many(256), ok].map((r) => ignoredSnapshot(r.root).over);
  }, [true, true, false, false]);
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
