// The usage and speed benchmark's pre-registered verdict rule: loads benchmarks/usage-speed/rule.json, validates
// its exact shape, and exposes its content hash and sealed state. Rule id: usage-speed-rule-v1 (the file's own
// `version` field is the registered version; a change to any value is a new version and a re-recorded baseline).
//
// Shape: the file is plain JSON data with exactly the keys below at every level; an unknown or missing key, a
// wrong type or an out-of-range number is a refusal (null from parseRule/loadRule, the reasons from ruleProblems).
//   version 1 (integer), sealed (boolean),
//   bootstrap {level in (0,1), resamples integer in [MIN_RESAMPLES, MAX_RESAMPLES], seed integer in [0, 2^32)},
//   minEffect {L0, L1 {effect, minRepeats integer >= 1}, L2 {time, cost, tokens, turns}} (fractions in (0, 1]),
//   qualityGuard {medianDrop, invalidShareIncrease} (fractions in (0, 1]),
//   metrics [{layer, metrics [strings], primary, secondary, primaryBasis, secondaryBasis}] (primary and secondary
//   are the layer table's text; the bases are "absolute" or "overhead", the secondary basis may be null).
//
// Hash: sha256, lowercase hex, over the canonical serialisation of the rule WITHOUT the `sealed` field. Canonical
// means JSON with no whitespace, every object's keys sorted by code unit at every depth, arrays kept in order,
// numbers and strings as JSON.stringify prints them. `sealed` is excluded because sealing is an act on an
// unchanged rule: a baseline recorded in the draft state must carry the same hash as the sealed rule it is
// later compared under.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MIN_RESAMPLES, MAX_RESAMPLES } from './bench-stats.mjs';

export const DEFAULT_RULE_PATH = fileURLToPath(
  new URL('../../../benchmarks/usage-speed/rule.json', import.meta.url),
);

const BASES = ['absolute', 'overhead'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const isFraction = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1;
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const isStr = (s) => typeof s === 'string' && s.length > 0 && s.length <= 400;

function exactKeys(v, keys, where, out) {
  if (!isObj(v)) { out.push(`${where} must be an object`); return false; }
  const own = Object.keys(v);
  for (const k of own) if (!keys.includes(k)) out.push(`${where}: unknown key ${JSON.stringify(k)}`);
  for (const k of keys) if (!Object.hasOwn(v, k)) out.push(`${where}: missing key ${JSON.stringify(k)}`);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(v, k));
}

/** Every reason the value is not a valid rule; an empty array means valid. */
export function ruleProblems(rule) {
  const out = [];
  const top = ['version', 'sealed', 'bootstrap', 'minEffect', 'qualityGuard', 'metrics'];
  if (!exactKeys(rule, top, 'rule', out)) return out;
  if (rule.version !== 1) out.push('version must be 1');
  if (typeof rule.sealed !== 'boolean') out.push('sealed must be a boolean');
  if (exactKeys(rule.bootstrap, ['level', 'resamples', 'seed'], 'bootstrap', out)) {
    const b = rule.bootstrap;
    if (!(typeof b.level === 'number' && b.level > 0 && b.level < 1)) out.push('bootstrap.level must be in (0, 1)');
    if (!isInt(b.resamples, MIN_RESAMPLES, MAX_RESAMPLES)) out.push('bootstrap.resamples out of range');
    if (!isInt(b.seed, 0, 2 ** 32 - 1)) out.push('bootstrap.seed must be an integer in [0, 2^32)');
  }
  if (exactKeys(rule.minEffect, ['L0', 'L1', 'L2'], 'minEffect', out)) {
    const m = rule.minEffect;
    if (!isFraction(m.L0)) out.push('minEffect.L0 must be a fraction in (0, 1]');
    if (exactKeys(m.L1, ['effect', 'minRepeats'], 'minEffect.L1', out)) {
      if (!isFraction(m.L1.effect)) out.push('minEffect.L1.effect must be a fraction in (0, 1]');
      if (!isInt(m.L1.minRepeats, 1, 1000)) out.push('minEffect.L1.minRepeats must be an integer >= 1');
    }
    if (exactKeys(m.L2, ['time', 'cost', 'tokens', 'turns'], 'minEffect.L2', out)) {
      for (const k of ['time', 'cost', 'tokens', 'turns']) {
        if (!isFraction(m.L2[k])) out.push(`minEffect.L2.${k} must be a fraction in (0, 1]`);
      }
    }
  }
  if (exactKeys(rule.qualityGuard, ['medianDrop', 'invalidShareIncrease'], 'qualityGuard', out)) {
    for (const k of ['medianDrop', 'invalidShareIncrease']) {
      if (!isFraction(rule.qualityGuard[k])) out.push(`qualityGuard.${k} must be a fraction in (0, 1]`);
    }
  }
  if (!Array.isArray(rule.metrics) || rule.metrics.length < 1 || rule.metrics.length > 16) {
    out.push('metrics must be an array of 1..16 rows');
  } else {
    rule.metrics.forEach((row, i) => {
      const keys = ['layer', 'metrics', 'primary', 'secondary', 'primaryBasis', 'secondaryBasis'];
      if (!exactKeys(row, keys, `metrics[${i}]`, out)) return;
      const at = `metrics[${i}]`;
      if (![row.layer, row.primary, row.secondary].every(isStr)) {
        out.push(`${at}: layer, primary, secondary must be strings`);
      }
      if (!Array.isArray(row.metrics) || row.metrics.length < 1 || !row.metrics.every(isStr)) {
        out.push(`${at}.metrics must be non-empty strings`);
      }
      if (!BASES.includes(row.primaryBasis)) out.push(`${at}.primaryBasis must be absolute or overhead`);
      if (row.secondaryBasis !== null && !BASES.includes(row.secondaryBasis)) {
        out.push(`${at}.secondaryBasis must be absolute, overhead or null`);
      }
    });
  }
  return out;
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** The rule's content hash (see the header): sha256 hex of the canonical form without `sealed`. */
export function ruleHash(rule) {
  const { sealed: _sealed, ...content } = rule;
  return createHash('sha256').update(canonical(content)).digest('hex');
}

/** A valid rule as { rule (deep-frozen copy), hash, sealed }, or null. */
export function parseRule(value) {
  if (ruleProblems(value).length > 0) return null;
  const rule = JSON.parse(JSON.stringify(value));
  const freeze = (o) => {
    if (o !== null && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); }
    return o;
  };
  return { rule: freeze(rule), hash: ruleHash(rule), sealed: rule.sealed };
}

/** Reads and parses a rule file; null for an unreadable file, invalid JSON or an invalid rule. */
export function loadRule(path = DEFAULT_RULE_PATH) {
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  return parseRule(value);
}
