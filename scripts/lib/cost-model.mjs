// One shipped, user-overridable mapping instead of scattering model names across instruction
// files: a repricing or a new model is an edit here. A host absent from the mapping gets no
// override — the caller omits the model argument and that host's own default applies (today's
// behavior, unchanged). A cost value outside the enum, or a mapped host missing that tier, throws
// rather than silently routing to an unintended model.

export const VALID_COSTS = Object.freeze(['low', 'medium', 'high']);

// Hosts with a verified model identifier for each tier. Add an entry to opt a new host into
// explicit model selection; leave a host out to keep it on its own default.
//
// TODO(cost-model maintainer): add copilot-cli / vscode once a verified model identifier exists
// for each tier; until then they return null and fall back to their own default.
export const HOST_MODELS = Object.freeze({
  'claude-code': Object.freeze({ low: 'haiku', medium: 'sonnet', high: 'opus' }),
});

/**
 * Resolves a declared cost tier to a concrete model for the given host.
 * @returns {string|null} the mapped model, or null when the host is absent from the mapping
 *   (no override for that host — the caller omits the model argument and its own default applies).
 */
export function resolveModel(cost, host, mapping = HOST_MODELS) {
  if (!VALID_COSTS.includes(cost)) {
    throw new Error(`cost-model: unrecognized cost "${cost}" (expected one of ${VALID_COSTS.join('|')})`);
  }
  if (!Object.hasOwn(mapping, host)) return null; // unmapped host: no override, its own default applies
  const models = mapping[host];
  const model = models[cost];
  if (!model) {
    throw new Error(`cost-model: host "${host}" has no "${cost}" entry in its mapping`);
  }
  return model;
}

// JSON.parse gives a "__proto__" key in parsed text a genuine OWN enumerable property (unlike
// object-literal syntax, which would set the prototype instead) — Object.keys/for-in sees it like
// any other key. A naive `{...defaults, ...override}` spread is safe against the accessor-setter
// gadget (spread uses DefineOwnProperty, not Set), but a config-sourced override is exactly the
// input a merge helper should not trust blindly, so disallowed keys are rejected outright rather
// than silently absorbed as an inert host entry.
const FORBIDDEN_HOST_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Merges a user-supplied per-host override (e.g. `.somi/config.json`'s `cost.mapping`) on top of
 * `defaults`, for use as resolveModel()'s third argument. A host present in `override` REPLACES
 * that host's whole tier map — never merged tier-by-tier — so mapping a host to `{}` makes every
 * tier for that host fail loudly via resolveModel() instead of silently falling back to the
 * shipped default. Throws on a disallowed or non-object override rather than absorbing it.
 */
export function mergeHostMapping(defaults, override) {
  if (override === undefined || override === null) return defaults;
  if (typeof override !== 'object' || Array.isArray(override)) {
    throw new Error('cost-model: mapping override must be an object');
  }
  const merged = { ...defaults };
  for (const host of Object.keys(override)) {
    if (FORBIDDEN_HOST_KEYS.has(host)) {
      throw new Error(`cost-model: mapping override has a disallowed host key "${host}"`);
    }
    const tiers = override[host];
    if (typeof tiers !== 'object' || tiers === null || Array.isArray(tiers)) {
      throw new Error(`cost-model: mapping override for host "${host}" must be an object of cost -> model`);
    }
    merged[host] = tiers;
  }
  return merged;
}
