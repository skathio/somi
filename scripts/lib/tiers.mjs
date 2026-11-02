// tiers.mjs: two tiers only, a work tier and a review tier, set per host in config. Pure: it names a model and the kernel records
// the name in the journal. A null model means "leave it to the host's default".

const DEFAULTS = Object.freeze({
  claude: Object.freeze({ work: 'sonnet', review: 'opus' }),
  copilot: Object.freeze({ work: null, review: null }),
});
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/;
const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

export function detectHost(env = process.env) {
  if (env.SOMI_HOST === 'claude' || env.SOMI_HOST === 'copilot') return env.SOMI_HOST;
  return env.COPILOT_CLI || env.COPILOT_HOME || env.COPILOT_PLUGIN_ROOT || env.COPILOT_PLUGIN_DATA ? 'copilot' : 'claude';
}

export function resolveTier(config, host, tier) {
  const fromConfig = plain(config?.tiers) && plain(config.tiers[host]) ? config.tiers[host][tier] : undefined;
  if (typeof fromConfig === 'string' && MODEL_NAME.test(fromConfig)) return fromConfig;
  return Object.hasOwn(DEFAULTS, host) ? DEFAULTS[host][tier] : null;
}
