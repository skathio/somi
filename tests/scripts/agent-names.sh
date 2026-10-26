#!/usr/bin/env bash
# Guard for agent identity (4.0.0 rename): every agents/*.md has a frontmatter `name` equal to its file
# stem; every specialist is `somi-` prefixed and only the front door is the bare `somi`; and every
# identifier-shaped reference in shipped text (`Task <agent>`, `--agent <agent>`, `agent: "<agent>"`,
# `cost.agents.<agent>`, `subagent_type=<agent>`) names a real agent, so a stale pre-4.0.0 name fails here.
set -uo pipefail

ROOT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "== agent names =="

check_tree() { # $1 = repo root; prints one line per problem
  node --input-type=module - "$1" <<'EOF'
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const problems = [];
const agentsDir = path.join(root, 'agents');
const stems = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
for (const stem of stems) {
  const text = fs.readFileSync(path.join(agentsDir, `${stem}.md`), 'utf8').replace(/\r\n/g, '\n');
  const name = /^---\n(?:.*\n)*?name: *([^\n]+)\n/.exec(text)?.[1]?.trim();
  if (name !== stem) problems.push(`agents/${stem}.md: frontmatter name ${JSON.stringify(name)} != file stem`);
  if (stem !== 'somi' && !stem.startsWith('somi-')) problems.push(`agents/${stem}.md: a specialist must be named somi-<name>`);
}
const known = new Set(stems);
const REF = /(?:\bTask |--agent |\bagent: ?["']?|cost\.agents\.|subagent_type[=:] ?)([a-z][a-z0-9-]*)/g;
const SKIP = new Set(['CHANGELOG.md']);
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(md|mjs|json)$/.test(e.name) && !SKIP.has(path.relative(root, p))) {
      const text = fs.readFileSync(p, 'utf8');
      for (const m of text.matchAll(REF)) {
        const id = m[1];
        // Placeholders and command recursions (`Task /code-loop`) are not agent ids.
        if (known.has(id) || /^(name|agent|x|foo|bad|the|a|an|one|each|that|this|is|tool|it|in|via)$/.test(id)) continue;
        if (!stems.includes(`somi-${id}`)) continue; // only flag names that are a renamed agent
        problems.push(`${path.relative(root, p)}: stale agent id "${id}" (use "somi-${id}")`);
      }
    }
  }
}
for (const d of ['agents', 'commands', 'skills', 'rules', 'docs', 'templates', 'hooks', 'scripts']) {
  if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
}
for (const f of ['README.md', 'AGENTS.md']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) for (const m of fs.readFileSync(p, 'utf8').matchAll(REF)) {
    if (!known.has(m[1]) && stems.includes(`somi-${m[1]}`)) problems.push(`${f}: stale agent id "${m[1]}" (use "somi-${m[1]}")`);
  }
}
process.stdout.write(problems.map((x) => `${x}\n`).join(''));
EOF
}

pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

out="$(check_tree "$ROOT_REPO")"
if [ -z "$out" ]; then ok "the shipped tree: names match stems, specialists are somi-*, no stale agent ids"; else bad "the shipped tree:"; printf '%s\n' "$out" | sed 's/^/       /'; fi

# Red proofs on a scratch copy: each class of mistake is caught.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
red() { # $1 = label, $2 = mutation (run in the copy)
  rm -rf "$TMP/r"; mkdir -p "$TMP/r"; cp -R "$ROOT_REPO/agents" "$ROOT_REPO/commands" "$TMP/r/"
  (cd "$TMP/r" && eval "$2")
  if [ -n "$(check_tree "$TMP/r")" ]; then ok "red proof: $1"; else bad "red proof: $1 (not caught)"; fi
}
red "a frontmatter name that differs from its stem" "sed -i 's/^name: somi-coder\$/name: coder/' agents/somi-coder.md"
red "a specialist file without the somi- prefix" "mv agents/somi-pr.md agents/pr.md; sed -i 's/^name: somi-pr\$/name: pr/' agents/pr.md"
red "a stale 'Task reviewer' line in a command" "printf 'Task reviewer (= /review)\n' >> commands/review.md"
red "a stale cost.agents.<old> key in prose" "printf 'set cost.agents.security-reviewer high\n' >> commands/review.md"

echo "agent-names tests: $pass ok, $fail failed"
[ "$fail" -eq 0 ]
