#!/usr/bin/env bash
# Guards the invariant that `npm test` stays hermetic and the eval corpus never ships to
# consumers. Kept in its own file so the invariant is not spread through a large diff.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$3', got '$2')"; fi; }

echo "== eval packaging & hermeticity =="

# --- the corpus must not ship ------------------------------------------------------------------
# `tests/` is in package.json's `files`, so exclusion needs tests/.npmignore -- a ROOT .npmignore
# does not override `files`. That mechanism was verified when the plan was written; this asserts
# the outcome rather than trusting it.
pack=$(npm pack --dry-run --json 2>/dev/null)
if [ -z "$pack" ]; then
  bad "npm pack --dry-run produced output"
else
  ok "npm pack --dry-run produced output"
  n_total=$(printf '%s' "$pack" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s)[0].files.length)))")
  for pat in 'tests/evals/' 'evals/fixtures' 'evals/tasks' 'evals/run.mjs' 'rubric.md' 'evals-fixtures.sh' 'eval-gate' 'budget-crosscheck'; do
    n=$(printf '%s' "$pack" | node -e "
      let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
        const f=JSON.parse(s)[0].files.filter(x=>x.path.includes(process.argv[1]));
        process.stdout.write(String(f.length));});" "$pat")
    check "npm tarball contains no '$pat'" "$n" "0"
  done
  # Floor: a tarball that is empty would pass every check above vacuously.
  if [ "${n_total:-0}" -ge 50 ]; then
    ok "npm tarball is non-empty ($n_total paths)"
  else
    bad "npm tarball is non-empty (want >=50, got ${n_total:-0})"
  fi
fi

# --- npm test must not EXECUTE the runner -------------------------------------------------------
# Structural and invocation-level, per the phase's exit criteria: a `node --check` glob merely
# NAMING tests/evals is explicitly permitted; executing the runner is not. A bare "no mention"
# grep would be self-contradicting, since validate.sh must name the directory to syntax-check it.
test_script=$(node -e "process.stdout.write(require('./package.json').scripts.test)")
check "npm test runs validate.sh, not the eval runner" "$test_script" "bash scripts/validate.sh"

# Scoped to what `npm test` actually reaches: the `test` script string, and validate.sh (which it
# runs). package.json's OTHER scripts may reference the runner -- eval:behavioral exists precisely
# to. Checking the whole file would flag the deliberate escape hatch as the leak.
reach_text=$( { printf '%s\n' "$test_script"; cat scripts/validate.sh; } )
# Every file under tests/evals with a main guard is an entrypoint. Each command of a reachable script line
# (split on ; && || |, `#` comments dropped) that runs one must carry a read-only flag AFTER the entrypoint
# path and no other flag there, unless the entrypoint has no model path (gate-check only reads a record file
# and git). `node --check <path>` is a syntax check and is skipped; `npm run eval:*` is always flagged. An
# entrypoint is any file passed in, so one not named here is treated as model-capable. A regression pin
# against honest drift, not a boundary: a computed command line or an `eval` gets past it. Stdin is the
# script text, the arguments are entrypoint paths; each offending command is printed. Residuals: `xargs node`,
# `cd tests/evals && node run.mjs` (a bare basename), `node -e "import('./tests/evals/run.mjs')"` and a trailing
# positional or variable after a read-only flag pass this pin.
UNSAFE_JS=$(cat <<'JSEND'
import { readFileSync } from 'node:fs';
const files = process.argv.slice(1).filter((f) => !f.endsWith('/gate-check.mjs'));
const RO = /^--(dry-run|merge|certify|help)$/;
const unq = (w) => w.replace(/^["']+|["']+$/g, '');
const out = [];
for (const raw of readFileSync(0, 'utf8').replace(/\\\n/g, ' ').split('\n')) {
  for (const cmd of raw.replace(/#.*$/, '').split(/&&|\|\||[;|]/)) {
    const words = cmd.trim().split(/\s+/).map(unq);
    if (/\bnpm\s+(run|run-script)\s+eval:/.test(cmd)) { out.push(cmd.trim()); continue; }
    for (const f of files) {
      const at = words.findIndex((w) => w === f || w.endsWith('/' + f.split('/').pop()));
      if (at < 0 || !words.slice(0, at).some((w) => /^(node|bash|sh)$/.test(w.split('/').pop()))) continue;
      if (words.slice(0, at).includes('--check')) continue;
      const flags = words.slice(at + 1).filter((w) => w.startsWith('-'));
      if (flags.length === 0 || !flags.every((w) => RO.test(w))) out.push(cmd.trim());
    }
  }
}
process.stdout.write(out.join('\n') + (out.length ? '\n' : ''));
JSEND
)
unsafe_invocations() { node --input-type=module -e "$UNSAFE_JS" "$@"; }
# Positive controls on synthetic text, outside the tarball guard: each flagged line is a bypass the pin once
# missed or a plain violation; the second text is read-only use and must pass.
bypass=$'node tests/evals/scratch.mjs\nnode tests/evals/scratch.mjs --dry-run --live\nnode tests/evals/scratch.mjs --dry-run && node tests/evals/scratch.mjs\nnode "$EVAL_TREE/scratch.mjs"\nnpm run eval:behavioral\nnode tests/evals/scratch.mjs --checkpoint\nnode --dry-run tests/evals/scratch.mjs\nnode tests/evals/scratch.mjs # --help\nnode \\\n  tests/evals/scratch.mjs'
check "the pin flags a scratch entrypoint run with no read-only flag after its path, with an extra flag, after a safe && command, via \$EVAL_TREE, via npm run eval:, with --checkpoint, with a flag before the path, with a flag only in a comment, or split over a continuation line" "$(printf '%s\n' "$bypass" | unsafe_invocations tests/evals/scratch.mjs | wc -l | tr -d ' ')" "9"
check "the pin passes read-only use, --check and gate-check with any flags" "$(printf '%s\n' 'node tests/evals/scratch.mjs --dry-run --help' 'node --check tests/evals/scratch.mjs; echo ok' 'node tests/evals/gate-check.mjs --records x' 'node "$EVAL_TREE/gate-check.mjs" --records x' | unsafe_invocations tests/evals/scratch.mjs tests/evals/gate-check.mjs | wc -l | tr -d ' ')" "0"
# Skipped in a published tarball, where tests/evals is absent BY DESIGN.
if [ -d tests/evals ]; then
  guards=$(grep -rlE 'import\.meta\.url === pathToFileURL\(process\.argv\[1\]|^const isMainModule' tests/evals --include='*.mjs' | sort)
  # shellcheck disable=SC2086
  reach=$(printf '%s\n' "$reach_text" | unsafe_invocations $guards)
  if [ -z "$reach" ]; then
    ok "every reachable invocation of a tests/evals entrypoint is read-only"
  else
    bad "every reachable invocation of a tests/evals entrypoint is read-only"
    printf '%s\n' "$reach" | sed 's/^/       /'
  fi
  check "the main-guard files under tests/evals are the known entrypoints" "$(printf '%s ' $guards)" "tests/evals/convergence.mjs tests/evals/gate-check.mjs tests/evals/run.mjs "
else
  ok "tests/evals absent (published tarball) - entrypoint invocation pin skipped"
fi

# The runner is reachable on purpose through its own script, which is NOT `test`.
have=$(node -e "const s=require('./package.json').scripts; process.stdout.write(s['eval:behavioral'] ?? 'MISSING')")
check "an explicit eval:behavioral script exists" "$have" "node tests/evals/run.mjs"

# The same pair for the convergence entrypoint, on its own script.
have2=$(node -e "const s=require('./package.json').scripts; process.stdout.write(s['eval:convergence'] ?? 'MISSING')")
check "an explicit eval:convergence script exists" "$have2" "node tests/evals/convergence.mjs"
check "every node \"\$CVD\" invocation in convergence-runner.sh is read-only or a negative-argument test (F-256)" "$(grep -nF 'node "$CVD"' tests/scripts/convergence-runner.sh | grep -vcE -- '--dry-run|--merge|--certify|--help|echo \$\?')" "0"

# --- npm test itself must not reach the network -------------------------------------------------
# Tests INVOCATION, not substrings. A URL inside a string literal is not a network call:
# check-links.sh builds `[a](https://e.com/x.md)` as a fixture, and eval-runner.sh's own
# hermeticity assertion contains the pattern `https?://` as a grep argument. A substring scan
# flags both, which trains the reader to ignore it -- the failure mode of a noisy guard.
net_failed=0
for f in scripts/validate.sh $(git ls-files 'tests/scripts/*.sh'); do
  hits=$(grep -nE '(^|[;&|(]|[[:space:]])(curl|wget|nc|ssh|scp)[[:space:]]|\$\{?ANTHROPIC_API_KEY|\$\{?OPENAI_API_KEY|process\.env\.(ANTHROPIC|OPENAI)' "$f" 2>/dev/null \
    | grep -vE "^[0-9]+:[[:space:]]*#" | grep -vE "grep -[a-zA-Z]*E?[[:space:]]+'")
  if [ -n "$hits" ]; then
    bad "$f makes no network call or credential read"
    printf '%s\n' "$hits" | sed 's/^/       /'
    net_failed=1
  fi
done
[ "$net_failed" -eq 0 ] && ok "no script reachable from npm test invokes a network client or reads a credential"

# --- node --check must cover the eval tree ------------------------------------------------------
if grep -qE 'EVAL_TREE="tests/evals"' scripts/validate.sh \
   && grep -qE "find hooks scripts \\\$EVAL_TREE -name '\\*\\.mjs'" scripts/validate.sh; then
  ok "validate.sh syntax-checks tests/evals/**/*.mjs"
else
  bad "validate.sh syntax-checks tests/evals/**/*.mjs"
fi
# Skipped in a published tarball, where the tree is absent BY DESIGN -- the exclusion asserted
# above. Failing here would make the guard contradict its own passing assertion.
if [ -d tests/evals ]; then
  n_mjs=$(find tests/evals -name '*.mjs' -type f | wc -l | tr -d ' ')
  if [ "$n_mjs" -ge 10 ]; then
    ok "there are .mjs files under tests/evals to check ($n_mjs)"
  else
    bad "there are .mjs files under tests/evals to check (want >=10, got $n_mjs)"
  fi
else
  ok "tests/evals absent (published tarball) - syntax-check scope assertion skipped"
fi

# --- NFR-13: eval entrypoints import only from ./lib/; libs import only siblings ----------------
# An entrypoint importing a sibling entrypoint is what forced lib/source.mjs out of run.mjs. Every
# top-level tests/evals/*.mjs is an entrypoint (the set is pinned below, so adding one forces this
# test to be revisited). The scan is textual, not a parse: it finds `import ... from`, bare
# `import '...'` and `export ... from` at a line start (indented or not) or right after a `;`, with
# or without a trailing `;` and with or without `with {...}` attributes. A `//` comment or a string
# on the same line is not matched; starless block comments and template literals can be. A dynamic
# `import(...)` or an import hidden behind unusual formatting could still slip past, so this is a
# tripwire, not a proof.
# Skipped in a published tarball, where tests/evals is absent BY DESIGN.
if [ -d tests/evals ]; then
  nfr13=$(node --input-type=module -e "
    import { readdirSync, readFileSync } from 'node:fs';
    const specs = (src) => [
      ...src.matchAll(/(?:^|;)\s*(?:import|export)(?![\w\$.])[^'\";]*?\bfrom\s*['\"]([^'\"]+)['\"]/gm),
      ...src.matchAll(/(?:^|;)\s*import\s*['\"]([^'\"]+)['\"]/gm),
    ].map((m) => m[1]).filter((x) => x.startsWith('.'));
    const entryBad = (x) => !x.startsWith('./lib/') || x.includes('..');
    const libBad = (x) => !x.startsWith('./') || x.includes('..');
    // The scanner must catch the shapes it exists for; these are synthetic, so no repo file is mutated.
    const mutants = [
      [entryBad, \"import { a } from '../x.mjs'\"],
      [entryBad, \"import a from './convergence.mjs'\"],
      [entryBad, \"  import a from './other.mjs'\"],
      [entryBad, \"import j from './j.json' with { type: 'json' }\"],
      [entryBad, \"import './side.mjs'\"],
      [entryBad, \"import a from './lib/a.mjs'; import b from './b.mjs'\"],
      [libBad, \"import { run } from '../run.mjs'\"],
    ];
    const blind = mutants.filter(([bad, src]) => !specs(src).some(bad)).map(([, src]) => src);
    const top = readdirSync('tests/evals').filter((n) => n.endsWith('.mjs')).sort();
    const found = [];
    let rel = 0, libs = 0;
    for (const f of top) for (const x of specs(readFileSync('tests/evals/' + f, 'utf8'))) {
      rel++; if (entryBad(x)) found.push(f + ' -> ' + x);
    }
    for (const f of readdirSync('tests/evals/lib').filter((n) => n.endsWith('.mjs'))) {
      libs++;
      for (const x of specs(readFileSync('tests/evals/lib/' + f, 'utf8'))) if (libBad(x)) found.push('lib/' + f + ' -> ' + x);
    }
    const out = [];
    if (top.join() !== 'convergence.mjs,gate-check.mjs,run.mjs') out.push('ENTRYPOINT SET ' + top.join());
    if (blind.length) out.push('SCANNER BLIND TO ' + blind.join(' | '));
    if (rel < 2 || libs < 10) out.push('VACUOUS ' + rel + '/' + libs);
    process.stdout.write(out.concat(found).join(';') || 'CLEAN');")
  check "tests/evals entrypoints import only ./lib/, and lib files only siblings (NFR-13)" "$nfr13" "CLEAN"

  # lib/source.mjs sits one directory deeper than run.mjs did; a wrong '..' count would silently
  # move the results directory, so the expected path is computed here independently.
  shard=$(node --input-type=module -e "
    import { resolve } from 'node:path';
    const src = await import('./tests/evals/lib/source.mjs');
    const run = await import('./tests/evals/run.mjs');
    const want = resolve('tests/evals/results/abc1234');
    process.stdout.write(JSON.stringify([src.shardDir('abc1234') === want, run.shardDir === src.shardDir,
      run.resolveSource === src.resolveSource, run.fixtureFor === src.fixtureFor]));")
  check "lib/source.mjs shardDir lands in tests/evals/results/<sha>; run.mjs re-exports the same functions" "$shard" "[true,true,true,true]"
else
  ok "tests/evals absent (published tarball) - NFR-13 import pin skipped"
fi

echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
