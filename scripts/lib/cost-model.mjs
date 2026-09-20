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
