#!/usr/bin/env bash
# Gate for the one dispatch line (#38) and native dispatch: the canonical "pass its `model`, start it as
# its `agent_type`, and put the cost line ..." phrase lives once, between markers in
# skills/somi-dispatch/SKILL.md, and every copy in commands/*.md and agents/somi.md must match it
# (whitespace and blockquote markers aside); every command that names the cost line names it through
# that phrase; the three agents that trim at `low` carry the same requested-tier disclosure; and no
# dispatch text calls somi_agent to stand in for an agent. Proven red on mutated copies.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }
echo "== dispatch line gate =="

gate() { # $1 = tree root; prints one line per problem
  node --input-type=module - "$1" <<'EOF'
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const norm = (s) => s.replace(/\n\s*>\s?/g, '\n').replace(/\s+/g, ' ');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const problems = [];
const skill = read('skills/somi-dispatch/SKILL.md');
const m = /<!-- dispatch-line:start -->\n([\s\S]*?)\n<!-- dispatch-line:end -->/.exec(skill);
if (!m) { console.log('skills/somi-dispatch/SKILL.md: no dispatch-line markers'); process.exit(0); }
const canon = norm(m[1]).trim();
const COST = 'requested cost: <tier> (not enforced: no mapped model)';
const files = [...fs.readdirSync(path.join(root, 'commands')).filter((f) => f.endsWith('.md')).map((f) => `commands/${f}`), 'agents/somi.md'];
for (const f of files) {
  const t = norm(read(f));
  const costLines = t.split(COST).length - 1;
  const canonLines = t.split(canon).length - 1;
  if (costLines !== canonLines) problems.push(`${f}: ${costLines} cost line(s) but ${canonLines} canonical dispatch phrase(s); copy the phrase from the skill's dispatch-line markers`);
  if (/somi_agent\(/.test(t)) problems.push(`${f}: calls somi_agent(...) -- an agent starts as its agent_type, never as text handed to another agent`);
}
if (/somi_agent\(/.test(norm(skill))) problems.push('skills/somi-dispatch/SKILL.md: calls somi_agent(...)');
const DISCLOSE = 'If the briefing said `requested cost: low` (not `dispatched at cost: low`), word it as: "Ran at `low` (requested, not enforced: the host chose the model)."';
for (const a of ['somi-coder', 'somi-planner', 'somi-refactorer']) {
  if (!norm(read(`agents/${a}.md`)).includes(DISCLOSE)) problems.push(`agents/${a}.md: missing the requested-low disclosure sentence`);
}
process.stdout.write(problems.map((p) => `${p}\n`).join(''));
EOF
}

out="$(gate "$ROOT")"
if [ -z "$out" ]; then ok "the shipped tree: one dispatch phrase, copied exactly; disclosure in all three; no somi_agent stand-in"; else bad "the shipped tree:"; printf '%s\n' "$out" | sed 's/^/       /'; fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
red() { # $1 = label, $2 = mutation run inside a copy
  rm -rf "$TMP/r"; mkdir -p "$TMP/r"; cp -R "$ROOT/commands" "$ROOT/agents" "$ROOT/skills" "$TMP/r/"
  (cd "$TMP/r" && eval "$2")
  if [ -n "$(gate "$TMP/r")" ]; then ok "red proof: $1"; else bad "red proof: $1 (not caught)"; fi
}
red "a command whose copy drifted (agent_type dropped)" "sed -i 's/, start it as its \`agent_type\`,/,/' commands/plan.md"
red "the canonical phrase edited in the skill only" "sed -i 's/start it as its \`agent_type\`, and put/start it as its \`agent_type\` and put/' skills/somi-dispatch/SKILL.md"
red "a command that hands agent text to somi_agent" "printf 'call somi_agent({name: \"somi-coder\"}) and start a general-purpose agent\n' >> commands/code.md"
red "a missing requested-low disclosure" "sed -i 's/requested, not enforced: the host chose the model/requested/' agents/somi-planner.md"

echo "dispatch-line-gate tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ]
