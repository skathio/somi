#!/usr/bin/env node
// somi-dispatch.mjs — CLI over scripts/lib/dispatch-resolver.mjs's resolveDispatch(): for a given
// agent, right now, what tier and model should run it?
//
// Zero-dependency: stdlib only. This is the mechanism a prompt (agents/somi.md) shells out to
// instead of judging cost tiers itself — the front door cannot invoke resolveModel/decideDispatch
// directly (a prompt has no way to call a function), so the arithmetic has to live in a shipped
// command it can run, mirroring how scripts/somi-loop.mjs is the state engine /code-loop shells
// out to rather than reimplementing inline.
//
// scripts/somi-mcp.mjs is the other consumer of the identical resolveDispatch() — a
// zero-dependency stdio MCP server, for hosts that launch a bundled MCP server instead of a
// shell. Neither surface re-derives the composition or the validation order; both call
// resolveDispatch() and turn its {ok, ...} result into their own shape (this file: exit code +
// stdout JSON / stderr message; the MCP server: a tool result). See
// scripts/lib/dispatch-resolver.mjs for the composition itself and the full error-code table.
//
// Agent files are resolved against THIS SCRIPT's own directory's parent (installRoot below), not
// the caller's project — a consuming project may have no agents/ directory of its own at all.
// `--agent` comes from a prompt, which may carry untrusted text, so the name is validated against
// a strict allowlist pattern before it ever touches a path (inside resolveDispatch()).
//
// Exit codes (callers branch on these — do not repurpose; scripts/lib/dispatch-resolver.mjs
// documents in full what produces each one, since the MCP server maps onto the identical four):
//   0   ok
//   64  usage error
//   65  unknown agent
//   66  malformed declaration
//   67  project environment/config failure
// A guessed model is never printed on any error path — only the success path emits JSON.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDispatch } from './lib/dispatch-resolver.mjs';

const PROG = 'somi-dispatch';
const USAGE = `usage: ${PROG}.mjs resolve --agent <name> [--host <host>] [--ceiling <tier>]`;

// EXIT_* are declared here, literally, even though only EXIT_USAGE is READ elsewhere in this
// file: scripts/lib/dispatch-resolver.mjs owns the canonical values and returns the numeric code
// directly in its {ok:false, code, message} result, rather than this file re-deriving it from
// these names. tests/scripts/somi-dispatch.sh and tests/scripts/somi-agent-dispatch-contract.sh
// both grep this exact `^const EXIT_[A-Z_]+ = [0-9]+;` shape from THIS file to prove the four
// codes stay pairwise distinct and match what agents/somi.md documents — removing the unused
// three would break that contract test, so they stay, matched value-for-value against
// scripts/lib/dispatch-resolver.mjs's own declarations.
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

function main() {
  const argv = process.argv.slice(2);
  const CMD = argv[0] || '';
  let rest = argv.slice(1);

  // `undefined`, not `''`, is "not given" -- the same sentinel
  // scripts/lib/dispatch-resolver.mjs's validateDispatchArgs() expects from every caller
  // (scripts/somi-mcp.mjs's tool arguments use it natively; an omitted JSON field is `undefined`
  // after parsing). `--host`/`--ceiling` can never reach `main()`'s end as `''`: requireValue()
  // dies on an explicitly empty flag value before assignment, so only "never passed" survives to
  // here, always as `undefined`.
  let AGENT;
  let HOST;
  let CEILING;

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

  const outcome = resolveDispatch({
    agent: AGENT,
    host: HOST,
    ceiling: CEILING,
    projectRoot: projectRoot(),
    installRoot: installRoot(),
  });

  if (!outcome.ok) fail(outcome.code, outcome.message);

  console.log(JSON.stringify(outcome.result));
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
