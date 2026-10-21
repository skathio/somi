#!/usr/bin/env bash
# Pins the usage and speed benchmark's procedure document (docs/USAGE-BENCHMARK.md), the evidence-report template and
# its worked example (benchmarks/usage-speed/reports/): every relative link resolves, the template names every
# required field, the example fills each of them and cites two different 40-hex commit ids (its baseline id equal to the
# committed baseline's) and the rule hash the shipped rule computes, the new prose carries no model name, retired tier
# word or planning-folder reference, the docs index lists the procedure, and the assembly snippet in the document runs
# against the committed baseline and compares clean with it. Each check is then proven red on a scratch copy with the
# thing it guards removed or broken. Hermetic: no model, no network, no credential. Skipped in a tarball, where
# benchmarks/ and tests/evals are absent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: benchmark procedure document, report template and example =="
if [ ! -d tests/evals ] || [ ! -d benchmarks/usage-speed ]; then echo "  (skipped: benchmarks/ or tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t bdoc.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

DOC=docs/USAGE-BENCHMARK.md
REPORTS=benchmarks/usage-speed/reports
TEMPLATE=$REPORTS/TEMPLATE.md
EXAMPLE=$REPORTS/example-l0-l1.md
BASELINE=benchmarks/usage-speed/baseline-8c44e2d.json

pass=0; fail=0
chk() { # name, got, want
  if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '  ok   %s\n' "$1"; else fail=$((fail+1)); printf '  FAIL %s (got %s, want %s)\n' "$1" "$2" "$3"; fi
}
quiet() { "$@" >/dev/null 2>&1; echo $?; }

REQUIRED=("Report date" "Candidate SHA" "Baseline SHA" "Candidate plugin version" "Baseline plugin version" "Rule version" "Rule hash"
  "Model alias" "Model tier" "Host fingerprint" "Primary metric" "Primary metric chosen on" "Guard status" "Distribution-only scenarios")

# Words that must not appear in the new prose. Built from fragments so this file does not trip the vocabulary gate itself.
MODEL_WORDS="op""us|son""net|hai""ku"
TIER_WORDS="MA""X|EC""O"

# ---- the checks, each a function of the file it reads, so the red proofs can point it at a damaged copy ----

links_ok() { # files... ; every relative link target (anchor stripped) exists; LINK_BASE, when set, stands in for the file's directory
  node -e '
const fs = require("fs"), path = require("path");
let bad = 0;
for (const f of process.argv.slice(1)) {
  const text = fs.readFileSync(f, "utf8").replace(/^(`{3,}|~{3,})[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const t = m[1].split("#")[0];
    if (t === "" || /^[a-z][a-z0-9+.-]*:/i.test(t)) continue;
    if (!fs.existsSync(path.resolve(process.env.LINK_BASE || path.dirname(f), t))) { console.error(f + ": unresolved link " + m[1]); bad++; }
  }
}
process.exit(bad ? 1 : 0);' "$@"
}

fields_ok() { # file ; every required field is a "- Label: value" bullet with a value
  local f="$1" l rc=0
  for l in "${REQUIRED[@]}"; do
    grep -Eq "^- ${l}: .+" "$f" || { echo "$f: missing field $l" >&2; rc=1; }
  done
  grep -q '^## Verdict table' "$f" || { echo "$f: no verdict table" >&2; rc=1; }
  grep -q '^## Limits' "$f" || { echo "$f: no limits block" >&2; rc=1; }
  return $rc
}

field() { grep -E "^- $2: " "$1" | head -1 | sed -E "s/^- $2: //"; }

example_ok() { # file ; two different 40-hex ids, the baseline's equal to the committed one, the shipped rule's hash, L2 carried as not measured
  local f="$1" cand base hash want_hash want_sha rc=0
  fields_ok "$f" || rc=1
  cand="$(field "$f" "Candidate SHA")"; base="$(field "$f" "Baseline SHA")"; hash="$(field "$f" "Rule hash")"
  [[ "$cand" =~ ^[0-9a-f]{40}$ ]] || { echo "$f: candidate id is not 40 hex" >&2; rc=1; }
  [[ "$base" =~ ^[0-9a-f]{40}$ ]] || { echo "$f: baseline id is not 40 hex" >&2; rc=1; }
  [ "$cand" != "$base" ] || { echo "$f: the two ids are equal" >&2; rc=1; }
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || { echo "$f: rule hash is not 64 hex" >&2; rc=1; }
  want_hash="$(node --input-type=module -e "const R = await import('./tests/evals/lib/bench-rule.mjs'); process.stdout.write(R.loadRule('./benchmarks/usage-speed/rule.json').hash)")"
  want_sha="$(node -p "require('./$BASELINE').sha")"
  [ "$hash" = "$want_hash" ] || { echo "$f: rule hash differs from the shipped rule's" >&2; rc=1; }
  [ "$base" = "$want_sha" ] || { echo "$f: baseline id differs from the committed baseline's" >&2; rc=1; }
  grep -qi 'not measured' "$f" || { echo "$f: does not carry L2 as not measured" >&2; rc=1; }
  return $rc
}

prose_ok() { # files... ; no model name, retired tier word, decision id or numbered phase or iteration
  local rc=0
  if grep -Eniw "$MODEL_WORDS" "$@"; then rc=1; fi
  if grep -Enw "$TIER_WORDS" "$@"; then rc=1; fi
  if grep -Eni '\bD[0-9]+\b|\b(phase|iteration) [0-9]|decisions\.md|\.somi/plans' "$@"; then rc=1; fi
  return $rc
}

# ---- the real files ----
chk "the procedure document exists" "$([ -f "$DOC" ] && echo yes || echo no)" yes
chk "relative links in the document, template and example resolve" "$(quiet links_ok "$DOC" "$TEMPLATE" "$EXAMPLE")" 0
chk "the template names every required field, a verdict table and a limits block" "$(quiet fields_ok "$TEMPLATE")" 0
chk "the example fills every required field and cites two ids and the shipped rule hash" "$(quiet example_ok "$EXAMPLE")" 0
chk "the new prose has no model name, tier word or planning reference" "$(quiet prose_ok "$DOC" "$TEMPLATE" "$EXAMPLE")" 0
chk "the docs index links the procedure" "$(quiet grep -q '(./USAGE-BENCHMARK.md)' docs/README.md)" 0
for need in 'usage-l0.mjs' 'usage-l1.mjs' 'usage-bench.mjs' 'usage-compare.mjs' 'TEMPLATE.md' 'example-l0-l1.md' 'baseline-8c44e2d.json' 'pilot/report.md' 'rule.json' '--primary' '--plan-only' 'git archive'; do
  chk "the procedure mentions $need" "$(quiet grep -qF -- "$need" "$DOC")" 0
done

# ---- the assembly snippet in the document runs, and its output compares clean with the baseline it was built like ----
if git rev-parse --git-dir >/dev/null 2>&1; then
  node -e '
const fs = require("fs");
const m = /```js\n([\s\S]*?)```/.exec(fs.readFileSync(process.argv[1], "utf8"));
if (!m) process.exit(1);
fs.writeFileSync(process.argv[2] + "/assemble-baseline.mjs", m[1]);
const b = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
fs.writeFileSync(process.argv[2] + "/l0.json", JSON.stringify({ L0: b.L0 }));
fs.writeFileSync(process.argv[2] + "/l1.json", JSON.stringify({ host: b.host, L1: b.L1 }));
fs.writeFileSync(process.argv[2] + "/alias", b.model.alias);
fs.writeFileSync(process.argv[2] + "/tier", b.model.tier);' "$DOC" "$TMP" "$BASELINE"
  chk "the document carries a runnable snippet" "$?" 0
  node "$TMP/assemble-baseline.mjs" "$ROOT" "$BASELINE" "$TMP/l0.json" "$TMP/l1.json" "$TMP/cand.json" "$(cat "$TMP/alias")" "$(cat "$TMP/tier")" >"$TMP/asm.out" 2>&1
  chk "the snippet assembles a schema-valid baseline with no L2 rows" "$?" 0
  grep -q ' 0 L2 row(s)' "$TMP/asm.out"; chk "the snippet reports zero L2 rows" "$?" 0
  node tests/scripts/manual/usage-compare.mjs "$TMP/cand.json" "$BASELINE" --primary bytes >"$TMP/cmp.out" 2>&1
  chk "the compare tool accepts the assembled file (exit 0)" "$?" 0
  grep -q '^VERDICT: inconclusive' "$TMP/cmp.out"; chk "an unchanged L0 reads inconclusive" "$?" 0
  node tests/scripts/manual/usage-compare.mjs "$TMP/cand.json" "$BASELINE" --primary time >"$TMP/cmp2.out" 2>&1
  chk "an L2 primary on empty L2 rows is refused (exit 64), as the example reports" "$?" 64
else
  echo "  (snippet run skipped: not a git checkout)"
fi

# ---- red proofs: the same checks must fail on a damaged scratch copy ----
red() { # label, command... ; the command must exit non-zero
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then fail=$((fail+1)); printf '  FAIL red proof survived: %s\n' "$label"; else pass=$((pass+1)); printf '  ok   red proof caught: %s\n' "$label"; fi
}

for l in "${REQUIRED[@]}"; do
  grep -Ev "^- ${l}: " "$TEMPLATE" > "$TMP/t.md"
  red "template without the field \"$l\"" fields_ok "$TMP/t.md"
  grep -Ev "^- ${l}: " "$EXAMPLE" > "$TMP/e.md"
  red "example without the field \"$l\"" example_ok "$TMP/e.md"
done
grep -v '^## Limits' "$TEMPLATE" > "$TMP/t.md"; red "template without a limits block" fields_ok "$TMP/t.md"
grep -v '^## Verdict table' "$TEMPLATE" > "$TMP/t.md"; red "template without a verdict table" fields_ok "$TMP/t.md"
sed -E 's/^(- Rule hash: ).*/\1'"$(printf 'a%.0s' $(seq 64))"'/' "$EXAMPLE" > "$TMP/e.md"; red "example with another rule hash" example_ok "$TMP/e.md"
sed -E 's/^(- Candidate SHA: ).*/\1abc1234/' "$EXAMPLE" > "$TMP/e.md"; red "example with a short candidate id" example_ok "$TMP/e.md"
base_sha="$(field "$EXAMPLE" "Baseline SHA")"
sed -E "s/^(- Candidate SHA: ).*/\1${base_sha}/" "$EXAMPLE" > "$TMP/e.md"; red "example whose two ids are equal" example_ok "$TMP/e.md"
sed -E "s/^(- Baseline SHA: ).*/\1$(printf 'b%.0s' $(seq 40))/" "$EXAMPLE" > "$TMP/e.md"; red "example whose baseline id is not the committed baseline's" example_ok "$TMP/e.md"
sed -E 's/not measured/measured/Ig' "$EXAMPLE" > "$TMP/e.md"; red "example that does not carry L2 as not measured" example_ok "$TMP/e.md"

mkdir -p "$TMP/x"
export LINK_BASE="$ROOT/docs"   # scratch copies of the document resolve their links as if they sat in docs/
cp "$DOC" "$TMP/x/doc0.md"
chk "an unmodified copy of the document passes the link check" "$(quiet links_ok "$TMP/x/doc0.md")" 0
{ cat "$DOC"; printf '\nSee [gone](./no-such-file.md).\n'; } > "$TMP/x/doc1.md"
red "document with a dead relative link" links_ok "$TMP/x/doc1.md"
{ cat "$DOC"; printf '\n[anchor only](#top) and [web](https://example.invalid/x) and `[code](./nope.md)`.\n'; } > "$TMP/x/doc2.md"
chk "anchors, web links and code spans are not link failures" "$(quiet links_ok "$TMP/x/doc2.md")" 0
unset LINK_BASE
printf 'See decision D%s and phase %s.\n' 4 3 > "$TMP/x/p2.md"; red "prose with a decision id and a numbered phase" prose_ok "$TMP/x/p2.md"
printf 'The %s tier.\n' "MA""X" > "$TMP/x/p3.md"; red "prose with a retired tier word" prose_ok "$TMP/x/p3.md"
sed '/(.\/USAGE-BENCHMARK.md)/d' docs/README.md > "$TMP/x/index.md"
red "docs index without the procedure" grep -q '(./USAGE-BENCHMARK.md)' "$TMP/x/index.md"

ran=$((pass + fail))
[ "$ran" -ge 60 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 60 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
