// quality/limits.mjs: the gate's thresholds. The defaults are SoMi-CC v1's starting points, taken from common practice (SonarSource,
// ESLint, PMD) and not yet calibrated against known-good code, which is the next step. The user's global config may set any of them,
// and the somi-config command asks before loosening one. A project's config is cloned input, so it may only tighten: a looser value
// there is ignored and reported. A benchmark scores with the defaults alone, so its results stay comparable.

export const DEFAULT_LIMITS = Object.freeze({
  function: Object.freeze({ cognitive: 15, depth: 4, lines: 60, params: 4 }),
  component: Object.freeze({ cognitive: 15, depth: 4, lines: 150, params: 4 }),
  test: Object.freeze({ cognitive: 5, depth: 2, lines: 40, params: 4 }),
  file: Object.freeze({ cognitive: 100, added_cognitive: 25 }),
  clones: Object.freeze({ tokens: 50, test_tokens: 100 }),
  css: Object.freeze({ nesting: 3, compound: 3, ids: 0, important: 0 }),
  suppressions: Object.freeze({ added: 0 }),
});

const valid = (v) => Number.isInteger(v) && v >= 0 && v <= 100000;
const NOT_A_LIMIT = 'not a quality limit';
const NOT_A_NUMBER = 'not a whole number from 0 to 100000';

// One value from one file. The user's own file may set it either way. A project's may only lower it, since lower is stricter for
// every limit here.
function apply(limits, ignored, { where, group, key, value }) {
  const name = `quality.${group}.${key}`;
  if (!(key in DEFAULT_LIMITS[group])) return ignored.push({ where, key: name, reason: NOT_A_LIMIT });
  if (!valid(value)) return ignored.push({ where, key: name, reason: NOT_A_NUMBER });
  if (where === 'project' && value > limits[group][key]) return ignored.push({ where, key: name, reason: `a project may only tighten a limit, and ${value} is looser than ${limits[group][key]}` });
  limits[group][key] = value;
  return null;
}

/** { limits, ignored } from the defaults, the global file's `quality` and the project file's `quality`, in that order. */
export function resolveLimits({ global = {}, project = {} } = {}) {
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([group, values]) => [group, { ...values }]));
  const ignored = [];
  for (const [where, layer] of [['global', global], ['project', project]]) {
    for (const [group, values] of Object.entries(layer?.quality ?? {})) {
      if (!DEFAULT_LIMITS[group]) { ignored.push({ where, key: `quality.${group}`, reason: NOT_A_LIMIT }); continue; }
      for (const [key, value] of Object.entries(values ?? {})) apply(limits, ignored, { where, group, key, value });
    }
  }
  return { limits, ignored };
}

/** True when `next` loosens any limit against `current`, which the config command confirms before writing. */
export function loosens(current, next) {
  return Object.entries(next ?? {}).some(([group, values]) => Object.entries(values ?? {}).some(([key, v]) => valid(v) && v > (current?.[group]?.[key] ?? DEFAULT_LIMITS[group]?.[key] ?? Infinity)));
}
