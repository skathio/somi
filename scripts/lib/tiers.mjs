// tiers.mjs: low, medium and high, set per environment in config. Pure: it names a model. No shared file carries a model name, because names differ per host and go stale, so this table is the one place Claude
// Code's aliases appear. Copilot ships no map: its models vary by plan, so the user sets them in config. A tier with no model is not
// enforced, the worker inherits the session's model, and the response says so.

export const TIERS = Object.freeze(['low', 'medium', 'high']);
const DEFAULTS = Object.freeze({
  claude: Object.freeze({ low: 'haiku', medium: 'sonnet', high: 'opus' }),
  copilot: Object.freeze({}),
});
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/;
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

export function detectHost(env = process.env) {
  if (env.SOMI_HOST === 'claude' || env.SOMI_HOST === 'copilot') return env.SOMI_HOST;
  return env.COPILOT_CLI || env.COPILOT_HOME || env.COPILOT_PLUGIN_ROOT || env.COPILOT_PLUGIN_DATA ? 'copilot' : 'claude';
}

// A ceiling caps every tier for a session or a project. It can only lower one.
function capped(config, tier) {
  const ceiling = plain(config?.tiers) ? config.tiers.ceiling : undefined;
  if (!TIERS.includes(ceiling)) return tier;
  return TIERS[Math.min(TIERS.indexOf(tier), TIERS.indexOf(ceiling))];
}

export function resolveTier(config, host, tier) {
  const fromConfig = plain(config?.tiers) && plain(config.tiers[host]) ? config.tiers[host][tier] : undefined;
  if (typeof fromConfig === 'string' && MODEL_NAME.test(fromConfig)) return fromConfig;
  return (Object.hasOwn(DEFAULTS, host) ? DEFAULTS[host][tier] : null) ?? null;
}

export function resolveSpawn(config, host, wanted) {
  const tier = capped(config, wanted);
  const model = resolveTier(config, host, tier);
  return { tier, model, enforced: model !== null };
}

// The tier the conversation itself runs on: medium, as a bare agent would run, unless the user chose otherwise. Work cheaper than that
// goes down to a worker and work that needs more goes up. A ceiling can lower it.
export function mainTier(config) {
  const chosen = plain(config?.tiers) ? config.tiers.main : undefined;
  return capped(config, TIERS.includes(chosen) ? chosen : 'medium');
}
