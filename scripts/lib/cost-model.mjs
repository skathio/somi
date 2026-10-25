// One shipped, user-overridable mapping instead of scattering model names across instruction
// files: a repricing or a new model is an edit here. A host absent from the mapping gets no
// override — the caller omits the model argument and that host's own default applies (today's
// behavior, unchanged). A cost value outside the enum, or a mapped host missing that tier, throws
// rather than silently routing to an unintended model.

export const VALID_COSTS = Object.freeze(['low', 'medium', 'high']);

// A mapped model can come from committed, cloned .somi/config.json -- untrusted input about to
// reach a prompt and possibly a host CLI -- so it must look like a model identifier, not just be
// a non-empty string.
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,127}$/;

// Hosts with a verified model identifier for each tier. Add an entry to opt a new host into
// explicit model selection; leave a host out to keep it on its own default.
//
// TODO(cost-model maintainer): add copilot-cli / vscode once a verified model identifier exists
// for each tier; until then they return null and fall back to their own default.
export const HOST_MODELS = Object.freeze({
  'claude-code': Object.freeze({ low: 'haiku', medium: 'sonnet', high: 'opus' }),
});

export const MAX_MODEL_CANDIDATES = 8;

/**
 * Resolves a declared cost tier to its ordered model candidates for the given host (#35). A mapping
 * entry is one model id, or a non-empty list of up to MAX_MODEL_CANDIDATES distinct ids in preference
 * order: plans and editors expose different model ids, so the caller passes the first one its host
 * actually offers. The resolver cannot see the host's model list; it only validates and orders.
 * @returns {string[]|null} the candidates (length >= 1), or null when the host is absent from the
 *   mapping (no override for that host — the caller omits the model argument and its own default applies).
 */
export function resolveModelCandidates(cost, host, mapping = HOST_MODELS) {
  if (!VALID_COSTS.includes(cost)) {
    throw new Error(`cost-model: unrecognized cost "${cost}" (expected one of ${VALID_COSTS.join('|')})`);
  }
  if (!Object.hasOwn(mapping, host)) return null; // unmapped host: no override, its own default applies
  const models = mapping[host];
  const entry = models[cost];
  if (entry === undefined) {
    throw new Error(`cost-model: host "${host}" has no "${cost}" entry in its mapping`);
  }
  // A user-supplied mapping (.somi/config.json's cost.mapping) can name a tier with a value of the
  // wrong shape -- that must die loudly here, at the one place every mapping (shipped or overridden)
  // is read, rather than hand a caller something that prints into JSON as a "model" no host can run.
  const list = Array.isArray(entry) ? entry : [entry];
  if (list.length === 0 || list.length > MAX_MODEL_CANDIDATES) {
    throw new Error(`cost-model: host "${host}"'s "${cost}" entry must be a model id or a list of 1 to ${MAX_MODEL_CANDIDATES} ids, got ${list.length}`);
  }
  for (const model of list) {
    if (typeof model !== 'string' || model === '') {
      throw new Error(`cost-model: host "${host}"'s "${cost}" entry must be a non-empty string, got ${JSON.stringify(model)}`);
    }
    if (!MODEL_ID_RE.test(model)) {
      throw new Error(`cost-model: host "${host}"'s "${cost}" entry "${model}" is not a valid model identifier`);
    }
  }
  if (new Set(list).size !== list.length) {
    throw new Error(`cost-model: host "${host}"'s "${cost}" list names the same model twice`);
  }
  return [...list];
}

/**
 * Resolves a declared cost tier to its preferred model for the given host: the first candidate.
 * @returns {string|null} the mapped model, or null when the host is absent from the mapping.
 */
export function resolveModel(cost, host, mapping = HOST_MODELS) {
  return resolveModelCandidates(cost, host, mapping)?.[0] ?? null;
}

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
    // A tier key outside VALID_COSTS is either a typo (this repo's own "low"/"medium"/"high") or a
    // stale key from a renamed tier -- either way it would sit unused forever, unflagged, since
    // resolveModel() only ever looks up the tier it actually selected. Reject the whole per-host
    // object rather than silently keeping the junk key alongside the valid ones.
    for (const tier of Object.keys(tiers)) {
      if (!VALID_COSTS.includes(tier)) {
        throw new Error(
          `cost-model: mapping override for host "${host}" has an unrecognized tier key "${tier}" ` +
          `(expected one of ${VALID_COSTS.join('|')})`,
        );
      }
    }
    merged[host] = tiers;
  }
  return merged;
}
