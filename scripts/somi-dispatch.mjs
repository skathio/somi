#!/usr/bin/env node
// somi-dispatch.mjs — deterministic dispatch resolver: for a given agent, right now, what tier
// and model should run it?
//
// Zero-dependency: stdlib only. This is the mechanism a prompt (agents/somi.md) shells out to
// instead of judging cost tiers itself — the front door cannot invoke resolveModel/decideDispatch
// directly (a prompt has no way to call a function), so the arithmetic has to live in a shipped
// command it can run, mirroring how scripts/somi-loop.mjs is the state engine /code-loop shells
// out to rather than reimplementing inline.
//
// Composition (never inline the pieces yourself; this is the one sanctioned call site):
//   resolveCeiling(projectRoot, --ceiling) -> decideDispatch(declaredCost, ceiling)
//     -> modelForDispatch(decision, host, mergeHostMapping(HOST_MODELS, cost.mapping))
//
// `cost.mapping` is read from the project's .somi/config.json on EVERY call, unlike the ceiling
// (re-read only at bootstrap -- see cost-ceiling.mjs's header): the mapping is a lookup table, not
// a gate, so a mid-session config fix taking effect on the very next dispatch is the correct
// behavior, not a reopened decision.
//
// Agent files are resolved against THIS SCRIPT's own directory, not the caller's project — a
// consuming project may have no agents/ directory of its own at all. `--agent` comes from a
// prompt, which may carry untrusted text, so the name is validated against a strict allowlist
// pattern before it ever touches a path.
//
// Exit codes (callers branch on these — do not repurpose):
//   0   ok
//   64  usage error (bad/missing arguments)
//   65  unknown agent (no agents/<name>.md at the install root)
//   66  malformed declaration (no cost:, or an invalid/unordered/duplicated cost set)
// A guessed model is never printed on any error path — only the success path emits JSON.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCeiling, decideDispatch, modelForDispatch, readCostConfig } from './lib/cost-ceiling.mjs';
import { HOST_MODELS, mergeHostMapping } from './lib/cost-model.mjs';

const PROG = 'somi-dispatch';
const AGENT_NAME_RE = /^[a-z][a-z0-9-]*$/;
const USAGE = `usage: ${PROG}.mjs resolve --agent <name> [--host <host>] [--ceiling <tier>]`;

const EXIT_USAGE = 64;
const EXIT_UNKNOWN_AGENT = 65;
const EXIT_MALFORMED = 66;

class ExitSignal extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

function fail(code, msg) {
  process.stderr.write(`${PROG}: ${msg}\n`);
  throw new ExitSignal(code);
}

function die(msg) {
  fail(EXIT_USAGE, `${msg}\n${USAGE}`);
}

// A missing (`--host` last) or explicitly empty (`--host ""`) value must fail here, at parse
// time -- not fall through to a `value || 'default'` downstream, which can't tell "not given"
// (correctly defaulted) from "given with nothing after it" (a caller error masquerading as one).
function requireValue(flag, value) {
  if (value === undefined || value === '') die(`${flag} requires a non-empty value`);
  return value;
}

// Matches scripts/somi-loop.mjs's projectRoot(): the caller's project, where .somi/config.json
// and .somi/somi-state/ceiling.json live. Deliberately NOT where agent files are read from —
// see installRoot() below.
function projectRoot() {
  let b = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (b.includes('${')) b = process.cwd();
  return b;
}

// SoMi's own install root: this file's directory's parent. A consuming project may have no
// agents/ of its own, so agent frontmatter is always read from where SoMi itself is installed,
// never from projectRoot().
function installRoot() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
}

// Extracts one field's raw value from the frontmatter block (the lines between the first two
// literal `---` delimiters) — same block scripts/validate.sh's cost_of()/model_of() awk parses,
// reimplemented here rather than shelling out to awk (Node stdlib only, per repo convention).
function frontmatterField(content, field) {
  const re = new RegExp(`^${field}:\\s*(.*)$`);
  let dashes = 0;
  for (const line of content.split('\n')) {
    if (line === '---') {
      dashes++;
      if (dashes >= 2) break;
      continue;
    }
    if (dashes === 1) {
      const m = re.exec(line);
      if (m) return m[1].trim();
    }
  }
  return undefined;
}

function main() {
  const argv = process.argv.slice(2);
  const CMD = argv[0] || '';
  let rest = argv.slice(1);

  let AGENT = '';
  let HOST = '';
  let CEILING = '';

  while (rest.length > 0) {
    const a = rest[0];
    switch (a) {
      case '--agent': AGENT = requireValue(a, rest[1]); rest = rest.slice(2); break;
      case '--host': HOST = requireValue(a, rest[1]); rest = rest.slice(2); break;
      case '--ceiling': CEILING = requireValue(a, rest[1]); rest = rest.slice(2); break;
      default: die(`unknown argument: ${a}`);
    }
  }

  if (CMD !== 'resolve') die(CMD ? `unknown subcommand: ${CMD}` : 'a subcommand is required');
  if (!AGENT) die('--agent is required');
  // Validated BEFORE any path is built or any file is touched — --agent is prompt-supplied text
  // and must never reach fs with a "../" or "/" in it.
  if (!AGENT_NAME_RE.test(AGENT)) {
    fail(EXIT_USAGE, `invalid --agent "${AGENT}" (expected ${AGENT_NAME_RE})`);
  }
  const host = HOST || 'claude-code';

  const agentPath = path.join(installRoot(), 'agents', `${AGENT}.md`);
  let content;
  try {
    content = fs.readFileSync(agentPath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') fail(EXIT_UNKNOWN_AGENT, `unknown agent "${AGENT}" (no ${agentPath})`);
    throw e;
  }

  const rawCost = frontmatterField(content, 'cost');
  if (!rawCost) {
    if (AGENT === 'somi') {
      fail(
        EXIT_MALFORMED,
        `agent "somi" is exempt from cost: — the host binds its model when the user selects it ` +
        `in the host's own UI, so there is nothing for this resolver to compute`,
      );
    }
    fail(EXIT_MALFORMED, `agent "${AGENT}" declares no cost: in its frontmatter`);
  }
  const declaredCost = rawCost.split(',').map((s) => s.trim());

  // --ceiling is validated inside resolveCeiling(); any throw there is classified as a usage
  // error ONLY when the caller explicitly passed --ceiling this call — a bad value already on
  // disk or in .somi/config.json is an environment problem, not a bad argument to this command.
  let ceilingResult;
  try {
    ceilingResult = resolveCeiling(projectRoot(), CEILING || undefined);
  } catch (e) {
    fail(CEILING ? EXIT_USAGE : EXIT_MALFORMED, e.message);
  }

  let decision;
  let model;
  try {
    decision = decideDispatch(declaredCost, ceilingResult.ceiling);
    // Read fresh per call, not per-bootstrap (see the header comment): this is how a project on a
    // host SoMi doesn't ship a mapping for (e.g. Copilot) tells SoMi which of ITS models counts as
    // low/medium/high. mergeHostMapping rejects a __proto__/constructor/prototype key and any
    // non-object per-host value outright -- this is user-controlled JSON reaching a merge, and
    // that denylist is never bypassed here.
    const mapping = mergeHostMapping(HOST_MODELS, readCostConfig(projectRoot()).mapping);
    model = modelForDispatch(decision, host, mapping);
  } catch (e) {
    fail(EXIT_MALFORMED, e.message);
  }

  console.log(JSON.stringify({
    agent: AGENT,
    supported: decision.supported,
    tier: decision.selected,
    model,
    ceiling: ceilingResult.ceiling,
    ceiling_source: ceilingResult.source,
  }));
}

try {
  main();
} catch (e) {
  if (e instanceof ExitSignal) {
    process.exitCode = e.code;
  } else {
    throw e;
  }
}
