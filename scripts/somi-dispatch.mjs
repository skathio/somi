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
//   64  usage error (bad/missing arguments, including an unrecognized --ceiling value or an
//       unrecognized SOMI_COST_CEILING value -- both are the caller telling this call which
//       ceiling to use and getting it wrong, whichever channel it came through)
//   65  unknown agent (no agents/<name>.md at the install root)
//   66  malformed declaration (no cost:, or an invalid/unordered/duplicated cost set) -- OR the
//       merged mapping's own resolution for the selected tier failing (a mapped host missing that
//       tier's entry, a non-string model value) WHEN the project's own cost.mapping never named
//       that host at all: only a bug in the shipped HOST_MODELS table could produce that (guarded
//       against by tests/scripts/cost-model.sh asserting every shipped entry resolves), so it is
//       this call's own composition, not a broken project file
//   67  project environment/config failure (corrupt .somi/somi-state/ceiling.json; an
//       unparsable/malformed-shape .somi/config.json; or a structurally invalid cost.mapping inside
//       it -- a __proto__/constructor/prototype host key, a non-object per-host value, a tier key
//       outside low|medium|high) -- distinct from 64 because the problem is the project's own
//       persisted files, not something the caller typed this call, and distinct from 66 because it
//       isn't this agent's own declaration, or an already-valid mapping's per-tier data, either --
//       ALSO 67 when the merged mapping's resolution fails (missing tier / non-string model) for a
//       host the project's own cost.mapping DID name: a partial override of a shipped host replaces
//       that host's whole tier map rather than merging it tier-by-tier, so overriding just one tier
//       silently drops the others -- the message names ".somi/config.json cost.mapping" so this
//       never reads as agent X's own broken cost: declaration
// A guessed model is never printed on any error path — only the success path emits JSON.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCeiling, decideDispatch, modelForDispatch, readCostConfig, CEILING_ENV } from './lib/cost-ceiling.mjs';
import { HOST_MODELS, mergeHostMapping, VALID_COSTS } from './lib/cost-model.mjs';

const PROG = 'somi-dispatch';
const AGENT_NAME_RE = /^[a-z][a-z0-9-]*$/;
const USAGE = `usage: ${PROG}.mjs resolve --agent <name> [--host <host>] [--ceiling <tier>]`;

const EXIT_USAGE = 64;
const EXIT_UNKNOWN_AGENT = 65;
const EXIT_MALFORMED = 66;
const EXIT_PROJECT_ENV = 67;

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
  // Validated here, before resolveCeiling() ever touches disk: a bad --ceiling value used to reach
  // resolveCeiling's own internal loadOrInitState() first, which bootstraps (and WRITES) the state
  // file before the value is checked -- so a rejected argument still left a state file behind. This
  // is pure syntax checking (no I/O), so it costs nothing to do before either file read below.
  if (CEILING && !VALID_COSTS.includes(CEILING)) {
    fail(EXIT_USAGE, `--ceiling expected one of ${VALID_COSTS.join('|')}, got "${CEILING}"`);
  }
  // Same reasoning, same fix, for the env-var channel: SOMI_COST_CEILING is caller input exactly
  // like --ceiling, not project state, so a bad value is a usage error (64) checked before any
  // disk touch -- never routed into resolveCeiling() where it would surface as a project-env
  // failure (67) alongside a genuinely corrupt config or state file.
  const envCeiling = process.env[CEILING_ENV];
  if (envCeiling && !VALID_COSTS.includes(envCeiling)) {
    fail(EXIT_USAGE, `${CEILING_ENV} expected one of ${VALID_COSTS.join('|')}, got "${envCeiling}"`);
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

  // Both --ceiling and SOMI_COST_CEILING were already syntax-checked above, before any disk write --
  // so anything resolveCeiling() throws now is the PROJECT's own persisted state, not this call's
  // arguments: an unparsable .somi/config.json, or a corrupt .somi/somi-state/ceiling.json. Every
  // one of those error messages already names the offending file (see cost-ceiling.mjs), so 67 plus
  // the message is enough to act on without repeating the path here.
  let ceilingResult;
  try {
    ceilingResult = resolveCeiling(projectRoot(), CEILING || undefined);
  } catch (e) {
    fail(EXIT_PROJECT_ENV, e.message);
  }

  // Read fresh per call, not per-bootstrap (see the header comment): this is how a project on a
  // host SoMi doesn't ship a mapping for (e.g. Copilot) tells SoMi which of ITS models counts as
  // low/medium/high. Captured once, before the merge, and kept around past it: modelForDispatch's
  // own catch below needs to know whether the PROJECT's mapping named this specific host at all,
  // to attribute a later resolution failure correctly.
  let projectMapping;
  try {
    projectMapping = readCostConfig(projectRoot()).mapping;
  } catch (e) {
    fail(EXIT_PROJECT_ENV, e.message);
  }

  // mergeHostMapping rejects a __proto__/constructor/prototype key, a non-object per-host value,
  // and a tier key outside low|medium|high outright -- this is user-controlled JSON reaching a
  // merge, and that denylist is never bypassed here. Kept in its OWN try/catch, distinct from
  // decideDispatch/modelForDispatch below: this fails only on the PROJECT's own persisted
  // .somi/config.json being structurally broken -- never on this agent's own `cost:` frontmatter.
  // Folding it into the same catch as decideDispatch used to misattribute a corrupt config file as
  // "agent X's cost: declaration is malformed" (66) when the agent's declaration was never the
  // problem: a config edited to something broken AFTER a session already bootstrapped its ceiling
  // state would surface this way on every call from then on.
  let mapping;
  try {
    mapping = mergeHostMapping(HOST_MODELS, projectMapping);
  } catch (e) {
    fail(EXIT_PROJECT_ENV, e.message);
  }

  // decideDispatch failing is always this AGENT's own cost: declaration (66) -- unrelated to the
  // mapping, so it stays in its own try/catch rather than sharing modelForDispatch's below.
  let decision;
  try {
    decision = decideDispatch(declaredCost, ceilingResult.ceiling);
  } catch (e) {
    fail(EXIT_MALFORMED, e.message);
  }

  // modelForDispatch failing here means the MERGED mapping is shape-valid (mergeHostMapping's
  // checks above already passed) but incomplete or wrong for the tier this call actually selected
  // -- missing that tier's entry, or a non-string model value. Whose fault that is turns on
  // whether the project's OWN cost.mapping named this host at all: if it did (a partial override
  // of a shipped host, which replaces that host's whole tier map rather than merging it
  // tier-by-tier, so overriding just one tier drops the others; or an incomplete custom host), the
  // gap is the project's own file, exit 67, and the message says so explicitly -- never let this
  // read as agent X's own broken cost: declaration. Only a host the project's mapping never
  // mentioned failing this way would point at a bug in the shipped HOST_MODELS table itself
  // (guarded against by tests/scripts/cost-model.sh), which stays 66.
  let model;
  try {
    model = modelForDispatch(decision, host, mapping);
  } catch (e) {
    if (projectMapping && Object.hasOwn(projectMapping, host)) {
      fail(EXIT_PROJECT_ENV, `${e.message} (in .somi/config.json cost.mapping)`);
    }
    fail(EXIT_MALFORMED, e.message);
  }

  console.log(JSON.stringify({
    agent: AGENT,
    supported: decision.supported,
    tier: decision.selected,
    model,
    ceiling: ceilingResult.ceiling,
    ceiling_source: ceilingResult.source,
    ceiling_origin: ceilingResult.ceiling_origin,
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
