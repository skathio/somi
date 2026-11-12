// quality/limits.mjs: the gate's thresholds, calibrated on 12 well-kept JavaScript and TypeScript projects (benchmarks/quality/). The
// function limits are the common SonarSource and ESLint ones, which a few percent of those projects' functions exceed. Tests may run
// longer, and a copy has to be SonarQube's 100 tokens, about ten lines, because shorter repeated patterns were most of the false alarms.
//
// The gate runs at two scopes. A commit is a small step, checked before it is made against the last commit. A pull request is the whole
// branch since it left the shared history. A function over a limit is over it at either scope, so every limit is shared except how much
// one change may add to a file: 25 in a commit, which is what the calibration measured, and 100 in a pull request, so a branch can add a
// new module. Either scope can override any limit under quality.commit or quality.pr.
//
// The user's global config may set any limit, and SoMi asks before an agent changes one. A project's config is cloned input, so it may
// only tighten: a looser value there is ignored and reported. A benchmark scores a whole draw as a pull request with the defaults alone,
// so its results stay comparable.

// commit and pr gate a change. repo is a report on the whole codebase as it stands, for cleanups and refactors.
export const CHANGE_SCOPES = Object.freeze(['commit', 'pr']);
export const SCOPES = Object.freeze([...CHANGE_SCOPES, 'repo']);

export const DEFAULT_LIMITS = Object.freeze({
  function: Object.freeze({ cognitive: 15, depth: 4, lines: 60, params: 4, options: 6 }),
  component: Object.freeze({ cognitive: 15, depth: 4, lines: 150, params: 4, options: 12 }),
  test: Object.freeze({ cognitive: 8, depth: 3, lines: 150, params: 4, options: 6 }),
  growth: Object.freeze({ cognitive: 5, lines: 20 }),
  file: Object.freeze({ cognitive: 100, added_cognitive: 25, lines: 400, added_lines: 300, functions: 40 }),
  imports: Object.freeze({ fan_out: 15 }),
  clones: Object.freeze({ tokens: 100 }),
  css: Object.freeze({ nesting: 3, compound: 3, ids: 0, important: 0 }),
  suppressions: Object.freeze({ added: 0 }),
});

// How long the gate may run before it counts as failed, in seconds. A large change on a slow machine needs longer than the default, so
// either file may set quality.timeout_seconds: the user's own either way, and a project's, which knows its own size, only to lengthen it.
// A gate that runs out of time is not a pass, so a cloned project cannot make the gate pass by shortening it, and may not make it fail
// every change that way either. The end-of-turn hook's own time, in
// hooks/hooks.json, is set above the maximum, so the host never cuts the gate off first.
export const QUALITY_TIMEOUT = Object.freeze({ default: 300, min: 10, max: 1800 });

const SCOPE_DEFAULTS = Object.freeze({ commit: {}, pr: { file: { added_cognitive: 100, added_lines: 1000 } }, repo: {} });

/** The default limits at one scope, as a fresh object. */
export function limitsFor(scope = 'pr') {
  if (!SCOPES.includes(scope)) throw new Error(`the quality scope is ${SCOPES.join(', ')}, not ${scope}`);
  const limits = Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([group, values]) => [group, { ...values }]));
  for (const [group, values] of Object.entries(SCOPE_DEFAULTS[scope])) Object.assign(limits[group], values);
  return limits;
}

const valid = (v) => Number.isInteger(v) && v >= 0 && v <= 100000;
const NOT_A_LIMIT = 'not a quality limit';
const NOT_A_NUMBER = 'not a whole number from 0 to 100000';

// One value from one file. The user's own file may set it either way. A project's may only lower it, since lower is stricter for
// every limit here.
function apply(limits, ignored, { where, prefix, group, key, value }) {
  const name = `${prefix}.${group}.${key}`;
  if (!(key in DEFAULT_LIMITS[group])) return ignored.push({ where, key: name, reason: NOT_A_LIMIT });
  if (!valid(value)) return ignored.push({ where, key: name, reason: NOT_A_NUMBER });
  if (where === 'project' && value > limits[group][key]) return ignored.push({ where, key: name, reason: `a project may only tighten a limit, and ${value} is looser than ${limits[group][key]}` });
  limits[group][key] = value;
  return null;
}

function applyLayer(limits, ignored, { where, prefix, layer }) {
  for (const [group, values] of Object.entries(layer ?? {})) {
    if (prefix === 'quality' && (SCOPES.includes(group) || group === 'timeout_seconds')) continue;
    if (!DEFAULT_LIMITS[group]) { ignored.push({ where, key: `${prefix}.${group}`, reason: NOT_A_LIMIT }); continue; }
    for (const [key, value] of Object.entries(values ?? {})) apply(limits, ignored, { where, prefix, group, key, value });
  }
}

/**
 * { limits, ignored } at one scope: the scope's defaults, then the global file's shared quality and its quality.<scope>, then the
 * project file's, in that order.
 */
export function resolveLimits({ global = {}, project = {}, scope = 'pr' } = {}) {
  const limits = limitsFor(scope);
  const ignored = [];
  for (const [where, file] of [['global', global], ['project', project]]) {
    applyLayer(limits, ignored, { where, prefix: 'quality', layer: file?.quality });
    applyLayer(limits, ignored, { where, prefix: `quality.${scope}`, layer: file?.quality?.[scope] });
  }
  return { limits, ignored: [...ignored, ...resolveTimeout({ global, project }).ignored] };
}

const TIMEOUT_KEY = 'quality.timeout_seconds';
const timeoutValid = (v) => Number.isInteger(v) && v >= QUALITY_TIMEOUT.min && v <= QUALITY_TIMEOUT.max;

/** { seconds, ignored }: the default, then the global file's quality.timeout_seconds, then the project's if it is longer. */
export function resolveTimeout({ global = {}, project = {} } = {}) {
  let seconds = QUALITY_TIMEOUT.default;
  const ignored = [];
  for (const [where, file] of [['global', global], ['project', project]]) {
    const value = file?.quality?.timeout_seconds;
    if (value === undefined) continue;
    if (!timeoutValid(value)) ignored.push({ where, key: TIMEOUT_KEY, reason: `not a whole number of seconds from ${QUALITY_TIMEOUT.min} to ${QUALITY_TIMEOUT.max}` });
    else if (where === 'project' && value < seconds) ignored.push({ where, key: TIMEOUT_KEY, reason: `a project may only lengthen the time, and ${value} is shorter than ${seconds}` });
    else seconds = value;
  }
  return { seconds, ignored };
}
