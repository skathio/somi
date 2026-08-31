#!/usr/bin/env node
// tests/evals/lib/smoke.mjs — D8's Option C: a frontmatter-driven, zero-model-call shape check
// for the 20 commands this work item does not gate with a live-model corpus (`decisions.md#d8`).
//
// **The load-bearing constraint is a negative one.** This module imports ONLY `installSomi` and
// `DEFINITION_DIRS` from `./install.mjs` — never its sibling export that shells out to the real
// `claude` CLI. That is what keeps this a smoke check rather than twenty more live agent
// invocations against R8's quota. Made structurally true, not just true by intention (this phase
// has twice needed a structural grep pin, not trust, to keep "no test reaches this site" honest —
// 2.4c's `judge-agreement.mjs`/`--judge-model` deletion and its `writeFileSync(shard, ...)` pin,
// both `decisions.md#d7`): `eval-runner.sh` greps this file for the model-invoking export's name
// as both an import specifier and a call site, and for that reason this comment does not spell
// that export's name out — a docstring quoting it as prose is exactly the false-positive shape a
// naive pin already caught elsewhere in this phase (2.4a's F-136). A *third*, behavioral pin (not
// grep-based — a route the two static greps can't see) covers what a grep on the import line
// structurally cannot: it runs `smokeCheck()` with a stub `claude` on `PATH` that touches a
// sentinel file and exits non-zero, then asserts the sentinel was never touched.
//
// **Genuine exercise, not restated syntax.** `scripts/validate.sh`'s frontmatter check is
// `grep -q '^---'` — presence of a frontmatter block, nothing about its contents. `smokeCheck()`
// installs the definition set for real (through the SAME `installSomi()` a live run would use),
// then validates the INSTALLED copy: a bug in the install/copy step itself (a directory silently
// not copied, a path that resolves differently once installed) is exactly the class of breakage
// this check exists to catch, not only a typo in the source file's own YAML.
//
// **One check derives from an independent source, the other is an explicit allowlist — both
// deliberately non-tautological**
// (`decisions.md#d8`'s correction: "every tool named in it is a real tool name, checked against
// the tool list this repo's own agent/command definitions draw from"):
//   - Tool names are checked against `CLAUDE_CODE_TOOLS` alone (below, a literal allowlist — a
//     hard-coded constant, not a dependency; D3's invariant is zero-*dependency*). An explicit
//     allowlist, not corpus popularity (F-153): an earlier version of this check unioned it with
//     every OTHER command's declared `allowed-tools`, which let two files agreeing on the same
//     bogus name validate each other — a name reachable by neither ground truth was still admitted
//     by two files agreeing, so the corpus half is gone rather than patched. A genuine tool this
//     repo hasn't adopted yet (e.g. `TodoWrite`) is recognized on the allowlist alone; extend
//     `CLAUDE_CODE_TOOLS` (its own doc comment below) when this repo adopts one not yet listed.
//   - Model tiers are checked against `agents/*.md`'s own `model:` frontmatter, not against a
//     tier list copied next to this check — `docs/AGENTS.md` states tiers are an agent-roster
//     concept ("SoMi tiers models by SDLC phase"), and agents/*.md carries no `allowed-tools`
//     field (checked directly: name/description/model only), so this source is independent of
//     the commands/*.md corpus being validated — no self-reference in either direction.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DEFINITION_DIRS, installSomi } from './install.mjs';

/** Claude Code's own built-in tool names — a literal constant, not a dependency (see the header
 * comment on D3). Exported so `eval-runner.sh` can pin it non-empty structurally, the same
 * discipline this phase already applies to other load-bearing constants (`N_PER_ARM`, `CERTIFY_N`).
 * Not exhaustive by design intent — extend it when this repo adopts a tool not yet listed here.
 */
export const CLAUDE_CODE_TOOLS = new Set([
  'Task', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'NotebookEdit',
  'WebFetch', 'WebSearch', 'TodoWrite', 'BashOutput', 'KillShell', 'ExitPlanMode', 'SlashCommand',
]);

/** Parses the flat `key: value` frontmatter block between the first two `---` lines. Hand-rolled,
 * not a YAML library (D3's zero-dependency invariant) — sufficient for this repo's own
 * frontmatter, which is single-line `key: value` pairs, never nested or multi-line. Returns
 * `null` when no closed frontmatter block exists.
 */
function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z][\w-]*):[ \t]?(.*)$/.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return { fields, bodyStart: end + 1 };
}

function splitList(value) {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** This repo's tiers, derived from `agents/*.md`'s own `model:` values — see the header comment. */
function tiersFromAgents(agentsDir) {
  const tiers = new Set();
  if (!existsSync(agentsDir)) return tiers;
  for (const f of readdirSync(agentsDir).filter((x) => x.endsWith('.md'))) {
    const fm = parseFrontmatter(readFileSync(join(agentsDir, f), 'utf8'));
    if (fm?.fields.model) tiers.add(fm.fields.model);
  }
  return tiers;
}

/**
 * Lists the un-gated commands: every `commands/*.md` file whose bare name (no `.md`) is not in
 * `gatedSet`. Pure discovery — no install, no frontmatter read; only `smokeCheck()` needs those.
 *
 * @param {string} commandsDir  path to a `commands/` directory (e.g. `<repo root>/commands`)
 * @param {Set<string>} gatedSet  bare command names (no leading `/`, no `.md`) to exclude
 * @returns {string[]} absolute-ish paths (joined to `commandsDir`), sorted
 */
export function discoverUngatedCommands(commandsDir, gatedSet) {
  return readdirSync(commandsDir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => !gatedSet.has(basename(f, '.md')))
    .sort()
    .map((f) => join(commandsDir, f));
}

/**
 * D8 Option C's zero-model-call smoke check for one command.
 *
 * `commandFile` may be any path shaped `<root>/commands/<name>.md` — the repo root itself
 * (`commands/`, `agents/`, `skills/` as siblings) or an already-installed `.claude/` tree; both
 * share that shape by construction (`installSomi()` copies each directory verbatim, so a synthetic
 * fixture rooted the same way is exercised identically to the real thing).
 *
 * Materializes its OWN install into a throwaway temp directory via `installSomi()` — real exercise
 * of the harness's install/copy wiring, not just this file's syntax — then validates the INSTALLED
 * copy: `description` is a non-empty string, `allowed-tools` is present and every named tool is
 * real, `model` is present and is one of this repo's tiers, and the installed tree actually
 * contains every directory `install.mjs`'s `DEFINITION_DIRS` names (D8's correction,
 * `decisions.md#d8`: narrower than "every body-referenced path resolves" — `scripts/check-links.mjs`
 * already owns resolving a command body's own links, fence-aware; this is the one property that
 * check cannot see, since it walks source, never an installed copy).
 *
 * @param {string} commandFile
 * @returns {{ok: true} | {ok: false, field: 'file'|'description'|'allowed-tools'|'model'|'install', reason: string}}
 */
export function smokeCheck(commandFile) {
  const name = basename(commandFile);
  const sourceDir = dirname(dirname(resolve(commandFile)));
  const workDir = mkdtempSync(join(tmpdir(), 'somi-smoke-'));
  try {
    installSomi(sourceDir, workDir);
    const installedRoot = join(workDir, '.claude');
    const installedFile = join(installedRoot, 'commands', name);
    if (!existsSync(installedFile)) {
      return { ok: false, field: 'file', reason: `${name}: installSomi() did not install this file into ${installedRoot}/commands` };
    }

    const content = readFileSync(installedFile, 'utf8');
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      return { ok: false, field: 'file', reason: `${name}: no closed '---' frontmatter block found` };
    }
    const { fields } = parsed;

    if (!fields.description || fields.description.trim() === '') {
      return { ok: false, field: 'description', reason: `${name}: frontmatter has no non-empty 'description'` };
    }

    if (!('allowed-tools' in fields)) {
      return { ok: false, field: 'allowed-tools', reason: `${name}: frontmatter has no 'allowed-tools'` };
    }
    const declaredTools = splitList(fields['allowed-tools']);
    if (declaredTools.length === 0) {
      return { ok: false, field: 'allowed-tools', reason: `${name}: 'allowed-tools' is present but empty` };
    }
    const unknownTool = declaredTools.find((t) => !CLAUDE_CODE_TOOLS.has(t));
    if (unknownTool) {
      return {
        ok: false,
        field: 'allowed-tools',
        reason: `${name}: '${unknownTool}' is not a Claude Code tool this repo recognizes (not in CLAUDE_CODE_TOOLS)`,
      };
    }

    if (!fields.model) {
      return { ok: false, field: 'model', reason: `${name}: frontmatter has no 'model'` };
    }
    const tiers = tiersFromAgents(join(installedRoot, 'agents'));
    if (!tiers.has(fields.model)) {
      return {
        ok: false,
        field: 'model',
        reason: `${name}: model '${fields.model}' is not one of this repo's tiers (${[...tiers].sort().join(', ') || 'none found'})`,
      };
    }

    for (const dir of DEFINITION_DIRS) {
      if (!existsSync(join(installedRoot, dir))) {
        return { ok: false, field: 'install', reason: `${name}: installSomi() did not install the '${dir}' directory into ${installedRoot}` };
      }
    }

    return { ok: true };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
