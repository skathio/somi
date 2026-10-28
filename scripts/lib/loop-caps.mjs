// loop-caps.mjs -- cap resolution for the loop engine, lifted out of somi-loop.mjs unchanged apart from its
// inputs: the environment arrives as a parameter and this file never reads process.env, so an in-process
// caller (the MCP tool) resolves against the env it was handed and a test can prove the isolation.
//
// --- mid-loop cap re-resolution --------------------------------------------
// `init` resolves caps once (CLI flag > env var > .somi/config.json > default) and
// freezes them into state -- deliberately, so the diff baseline and pass history stay
// stable across a whole loop. But commands/code-loop.md's Guardrails document a
// remedy for a gate that's wrong for the work at hand: "the user adjusts the env var
// explicitly and re-runs -- the loop does not 'decide' to widen its own bounds." That
// remedy needs a path that re-reads the override on the SAME subcommand (`pass`,
// `check-diff`), without `init --force` (which discards `pass`/`history`).
//
// `pass` and `check-diff` call reresolveCap() below before their gate check.
// Precedence matches what's documented: CLI flag > env var > .somi/config.json >
// default -- an explicit CLI flag or env var THIS invocation is the only thing that
// can move the cap; absent one, the cap already in force for the loop stands (a
// `.somi/config.json` edit made while a loop is running must NOT silently reopen an
// already-resolved gate). A resolved value that differs from what's stored is
// persisted into `caps` immediately, with an entry appended to a `cap_overrides`
// audit trail (field, from, to, source, after_pass, at) -- the after-the-fact record
// the documented remedy needs, since the env var itself lives only in a shell that
// may since have exited. `cap_overrides` is created lazily, only on the first real
// override, so a loop that never overrides anything keeps exactly today's state
// shape (no golden-fixture regeneration forced by this fix). `baseline_sha`,
// `started`, `pass`, and `history` are never touched here.
//
// Every value that reaches `Number()` on this path is user input (a CLI flag, an env
// var, or a config value) and is validated before use: `Number()` on a malformed
// string (`"1,000"`, `"unlimited"`) yields NaN, which is false against BOTH gate
// comparisons (`cur + 1 > max`, `weighted > cap`) -- silently switching the gate off
// -- and `JSON.stringify` then persists that NaN as `null`, which the next bare call
// falls through past (via `firstDefined`) to re-arm at the default, with no
// `cap_overrides` entry recording the reversion. `validateCap()` rejects rather than
// coerces, so a malformed value dies loudly instead of disabling a gate.

import { usageError } from './loop-exit.mjs';

export function configVal(config, keys) {
  let cur = config;
  for (const k of keys) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[k];
  }
  return cur === null ? undefined : cur;
}

// Mirrors bash's `${a:-${b:-$c}}` — first arg that is neither unset nor an
// empty string wins (a numeric 0 counts as "set", matching bash treating the
// non-empty string "0" as set).
export function firstDefined(...vals) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v === '') continue;
    return v;
  }
  return undefined;
}

const CAP_ENV = {
  code: { max_passes: 'SOMI_CODE_LOOP_MAX_PASSES', diff_cap_lines: 'SOMI_CODE_LOOP_DIFF_CAP' },
  plan: { max_passes: 'SOMI_PLAN_LOOP_MAX_PASSES' },
};
const CAP_FLAG = { max_passes: '--max-passes', diff_cap_lines: '--diff-cap' };
const CAP_CONFIG_SECTION = { code: 'code_loop', plan: 'plan_loop' };
const CAP_DEFAULT = { max_passes: 3, diff_cap_lines: 400 };

// Rejects a malformed cap value rather than letting `Number()` coerce it to NaN.
// `label` names the source in the error so the error points at what to fix
// (a specific flag, env var, or the generic field name at `init`, where the value
// may have come from any of CLI/env/config).
export function validateCap(raw, label) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw usageError(`${label}: expected a non-negative integer, got "${raw}"`);
  }
  return n;
}

// Resolves one cap at `init`, reading the same CAP_ENV / CAP_CONFIG_SECTION /
// CAP_DEFAULT tables reresolveCap() uses, so the two paths cannot silently diverge
// on an env var name, a config key, or a default value.
export function resolveInitCap(env, config, family, field, argVal) {
  if (field === 'diff_cap_lines' && family === 'plan') return 0; // plan loops have no diff cap
  const envVar = CAP_ENV[family][field];
  const fromConfig = configVal(config, [CAP_CONFIG_SECTION[family], field]);
  const picked = firstDefined(argVal, env[envVar], fromConfig, CAP_DEFAULT[field]);
  return validateCap(picked, field);
}

// `at` is the timestamp an override entry records, supplied by the caller so this file keeps no clock.
export function reresolveCap(env, state, field, argVal, at) {
  const family = state.loop === 'plan' ? 'plan' : 'code';
  if (field === 'diff_cap_lines' && family === 'plan') {
    return { resolved: 0, override: null }; // plan loops have no diff cap (see `init`)
  }
  const envVar = CAP_ENV[family][field];
  const stored = state.caps[field];
  const explicit = firstDefined(argVal, env[envVar]);
  const isCli = argVal !== undefined && argVal !== '';
  const resolved = explicit === undefined
    ? stored
    : validateCap(explicit, isCli ? CAP_FLAG[field] : envVar);
  let override = null;
  if (explicit !== undefined && resolved !== stored) {
    override = {
      field,
      from: stored,
      to: resolved,
      source: isCli ? 'cli' : 'env',
      after_pass: state.pass,
      at,
    };
  }
  return { resolved, override };
}

// Mutates `state.caps[field]` and appends the audit entry. Caller still owns calling
// saveState() -- kept separate so `pass`/`check-diff` persist the override BEFORE
// their gate check can throw, not only on the success path.
export function applyCapOverride(state, override) {
  state.caps[override.field] = override.to;
  if (!Array.isArray(state.cap_overrides)) state.cap_overrides = [];
  state.cap_overrides.push(override);
}
