// path-facts.mjs — classifyPaths(paths, config): what kind of change do these model-named paths describe?
//
// Pure string work: no filesystem call and no file content, so no result can carry any. The caller has already
// refused unsafe paths at path-safety's door; this module only classifies names. Per path it returns
//   { path, denied, production, module, sensitive: [names], boundary: [names], contract: [names] }
// and over the list { files, production_files, modules, sensitive, boundary, contract } (names sorted, unique).
// A denied name (path-safety's deny list) is a hit on the built-in `deny_list` name in the sensitive and boundary
// lists whatever the config says, so the floor it carries survives a refusal elsewhere.
//
// Config only adds: `signals.sensitive_paths` globs are appended to the built-ins and `signals.module_containers`
// names are unioned with BUILTIN_CONTAINERS. Neither can remove a built-in, there is no map from directories to a
// shared module key, and a key that fails its shape check adds nothing (the defaults still apply). That keeps every
// fact one-sided: no config can lower a hit list or the module count. `classifyPaths` takes the config layers
// ([global, project] from loadConfig; one object is one layer) and checks and unions each layer and each key alone,
// because mergeConfig replaces arrays between layers: a committed project layer must not erase the user's own
// additions, and one bad key drops only itself.
// `production_files` counts names that do not read as tests; a consumer must not lower anything on it alone.
//
// Globs are folded to lower case and matched by the code below, never turned into a regular expression: `*` is any
// run inside one path segment, `?` one character, a `**` segment any number of segments, anything else is itself.
// A glob without a slash matches one segment anywhere; with a slash it is anchored at the root and also matches
// what is under it. Some filesystems ignore a trailing dot or space on a name (`package.json.` is `package.json`), so
// a path is read as written and with those trimmed, and a glob hits when either reading does: the trim adds a
// reading and never replaces one. A glob or container name is trimmed the same way, and one that trims to nothing, or
// whose trim leaves only wildcards (`*.` would widen to `*`), is refused.
// Some code points fold to a separator (U+FF0F is `/`): the primary reading folds each segment of the path as written, so
// `tests／x.js` is one segment and a file, never the directory `tests`. A second, re-split reading (fold, then split, as a
// glob is read) is an extra one for glob hits only. Test directories and file names are judged on the primary reading
// as written only, so neither a trimmed nor a re-split name can turn production code into a test.
// Cost is bounded by the caps on layers (MAX_LAYERS, which `loadConfig` fills), glob count per layer, and glob and path length
// counted on the FOLDED text (NFKC grows a name: U+FDFA is 18 characters), so a path has at most MAX_PATH_CHARS folded characters
// and, since a separator needs a character either side, at most 120 segments in any reading. A path over a cap is an unusable
// entry with the floor, a glob over its cap is refused. At most four readings per path (two in the common case, one when the
// name has no trailing dot or space). `**` runs in a glob are collapsed so a long run is one step.
// `classifyPaths` takes `loadConfig`'s `{global, project}` result as it is, or an array of layers, or one layer; the merged `.config`
// must never be passed (mergeConfig replaces an array between layers, so it would erase the user's own additions).
// A layer key that is refused (one bad glob drops its whole key list) is reported in `refused` by key name, never silently.
import { MAX_PATHS, MAX_PATH_CHARS, denyListed, foldName as fold, trimDots as trim } from './path-safety.mjs';

export const MAX_GLOBS = 32;
export const MAX_GLOB_CHARS = 100;
export const MAX_LAYERS = 2;
export const BUILTIN_CONTAINERS = Object.freeze(['packages', 'apps', 'libs', 'src']);
const DENY_LIST = 'deny_list';

// Conservative on purpose: a false positive seats an extra reviewer, a false negative is covered by the model
// naming one more path. Names are reason ids, never prose.
const DEFAULTS = {
  sensitive: {
    secrets: ['*secret*', '*credential*', '*password*', '*passwd*'],
    auth: ['auth', 'auth.*', 'auth-*', 'auth_*', 'authn*', 'authz*', '*oauth*', '*jwt*', '*session*', '*permission*'],
    crypto: ['*crypt*', '*cipher*'],
    migrations: ['migrations', 'migration*', 'migrate'],
    infra: ['.github', '.gitlab-ci.yml', 'dockerfile*', 'docker-compose*', '*.tf'],
    ci: ['.github', '.gitlab', '.gitlab-ci.y*ml', '.gitea', '.forgejo', 'action.y*ml', '.circleci', '.travis.yml', 'azure-pipelines*.y*ml', '.azure-pipelines', 'bitbucket-pipelines.yml', 'jenkinsfile*', '*.jenkinsfile', '.buildkite', '.drone*.yml', '.woodpecker*', 'appveyor.yml', 'cloudbuild*.y*ml', 'buildspec*.y*ml', '.pre-commit-config.yaml'],
  },
  boundary: {
    routes: ['routes', 'route', 'route.*', 'router*', 'controllers', 'handlers', 'api', 'endpoints', 'middleware', 'webhook*', 'graphql'],
    data: ['*.sql', 'migrations', 'migrate', 'repositories', 'dao', 'db', 'database'],
    process: ['*exec*', '*shell*', '*spawn*', '*subprocess*'],
    input: ['*upload*', '*deserializ*', '*multipart*'],
  },
  contract: {
    lockfile: ['*.lock', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'go.sum'],
    manifest: ['package.json', 'pyproject.toml', 'setup.py', 'requirements*.txt', 'cargo.toml', 'go.mod', 'gemfile', 'composer.json', 'pom.xml', 'build.gradle*', '*.csproj'],
    schema: ['*.proto', 'openapi*', 'swagger*', '*.graphql', '*.avsc', '*.xsd'],
  },
};
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', '__mocks__', 'testdata']);
const TEST_FILES = ['*.test.*', '*.spec.*', '*_test.*', '*-test.*', '*_tests.*', '*-tests.*', '*_spec.*', 'test_*'];

// Separators only, no folding: the module key keeps the case a case-sensitive filesystem tells apart.
const parts = (s) => s.split(/[\\/]+/).filter((x) => x !== '' && x !== '.');
// The primary reading: split on the raw separators, then fold each segment, so a segment keeps a folded-in separator.
const split = (s) => parts(s).map(fold);
// The re-split reading: fold, then split (how a glob is read), so `a／b` is `a`, `b`.
const resplit = (s) => parts(fold(s));
const trimmed = (segs) => segs.map(trim).filter(Boolean);
// The readings a glob is tried against, without repeats (the common name has one or two, so the cost grows only for odd names).
const readings = (raw) => { const p = split(raw); const r = resplit(raw); return [...new Map([p, trimmed(p), r, trimmed(r)].map((x) => [JSON.stringify(x), x])).values()]; };
const globParts = (g) => trimmed(resplit(g));
const collapse = (g) => g.filter((p, i) => p !== '**' || g[i - 1] !== '**');
const compile = (glob) => collapse(/[\\/]/.test(glob) ? globParts(glob) : ['**', ...globParts(glob)]);
const build = (byName) => Object.entries(byName).map(([name, globs]) => [name, globs.map(compile)]);
const SENSITIVE = build(DEFAULTS.sensitive);
const BOUNDARY = build(DEFAULTS.boundary);
const CONTRACT = build(DEFAULTS.contract);

// One segment against one glob segment: the iterative two-pointer form, so a run of stars cannot blow up.
function segMatch(p, s) {
  let i = 0; let j = 0; let star = -1; let mark = 0;
  while (j < s.length) {
    if (p[i] === '*') { star = i++; mark = j; }
    else if (i < p.length && (p[i] === '?' || p[i] === s[j])) { i++; j++; }
    else if (star >= 0) { i = star + 1; j = ++mark; }
    else return false;
  }
  while (p[i] === '*') i++;
  return i === p.length;
}

// Which segment positions the glob can have consumed so far; matched once the whole glob is consumed.
function globMatches(glob, segs) {
  let at = new Set([0]);
  for (const part of glob) {
    const next = new Set();
    if (part === '**') for (let k = Math.min(...at); k <= segs.length; k++) next.add(k);
    else for (const pos of at) if (pos < segs.length && segMatch(part, segs[pos])) next.add(pos + 1);
    at = next;
  }
  return at.size > 0;
}

const hitsOf = (rules, reads) => rules.filter(([, globs]) => globs.some((g) => reads.some((segs) => globMatches(g, segs)))).map(([name]) => name);
const isTest = (segs) => segs.slice(0, -1).some((s) => TEST_DIRS.has(s)) || TEST_FILES.some((g) => segMatch(g, segs.at(-1) ?? ''));
// A container's children are modules (`packages/a`), never the bare child, so one name under two containers is two
// modules; a file directly in a container, or at the root, belongs to the container, or to the root's one module.
// `segs` are the unfolded segments of the path. Container names are stored trimmed, so a first segment that is the
// container written with a trailing dot or space (`services.`) still names it; the key keeps the text as written.
const moduleOf = (segs, containers) => {
  if (segs.length < 2) return '';
  const head = trim(fold(segs[0]));
  return containers.has(head) && segs.length > 2 ? `${segs[0]}/${segs[1]}` : segs[0];
};

const field = (o, k) => (o !== null && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k) ? o[k] : undefined);
// Shape checks on the text as written: a glob never reaches the filesystem, so `..` and absolute only need refusing.
// `widened` reads the segments as written (a `.` segment included, which `parts` drops): `*.` and `*/.` both read as `*`.
const wild = (s) => /^[*?]+$/.test(s);
const widened = (g) => { const r = fold(g).split(/[\\/]+/).filter((x) => x !== ''); return r.some((s, i) => { const t = trim(s); return t !== s && (wild(t) || (t === '' && wild(r[i - 1] ?? ''))); }); };
const validGlob = (g) => !/[\p{C}\p{Zl}\p{Zp}]/u.test(g) && !/^(?:[\\/]|[a-z]:)/i.test(g) && !g.includes('..') && fold(g).length <= MAX_GLOB_CHARS && globParts(g).length > 0 && !widened(g);
// A container is exactly one plain segment (`services/`, `./services` and `services.` are `services`); anything else is no container.
const containerName = (g) => { const s = globParts(g); return s.length === 1 && !/[*?]/.test(s[0]) ? s[0] : null; };
const bounded = (v, ok) => Array.isArray(v) && v.length <= MAX_GLOBS && v.every((g) => typeof g === 'string' && g.length > 0 && g.length <= MAX_GLOB_CHARS && ok(g));

// loadConfig's `{global, project}` result is the layers [global.config, project.config]; otherwise an array is the layers and anything else one layer.
const layersOf = (l) => (field(field(l, 'global'), 'config') !== undefined && field(field(l, 'project'), 'config') !== undefined ? [l.global.config, l.project.config] : Array.isArray(l) ? l : [l]);

// The additions of every layer; a key that is invalid adds nothing (and is named in `refused`), and no layer or key affects another's.
function additions(layers) {
  const out = { sensitive: [], containers: [], refused: [] };
  for (const layer of layers) {
    const sizing = field(layer, 'signals');
    const globs = field(sizing, 'sensitive_paths') ?? [];
    const names = field(sizing, 'module_containers') ?? [];
    if (bounded(globs, validGlob)) out.sensitive.push(...globs.map(compile)); else out.refused.push('sensitive_paths');
    if (bounded(names, (g) => validGlob(g) && containerName(g))) out.containers.push(...names.map(containerName)); else out.refused.push('module_containers');
  }
  return out;
}

export function classifyPaths(paths, layers) {
  const layerList = layersOf(layers);
  const extra = additions(layerList);
  const sensitive = [...SENSITIVE, ['config', extra.sensitive]];
  const containers = new Set([...BUILTIN_CONTAINERS, ...extra.containers]);
  // A list that is not an array, or is over the count cap, or a config with more layers than MAX_LAYERS (a layer list that long
  // is not what loadConfig gives, and dropping one would drop an addition), is MAX_PATHS unusable entries: it floors instead of vanishing.
  // An unusable entry is a module of its own (`/?<index>`: a key with a separator, which no real module key has), so the counts are the largest the cap allows.
  const list = Array.isArray(paths) && paths.length <= MAX_PATHS && layerList.length <= MAX_LAYERS ? paths : Array(MAX_PATHS).fill(null);
  const files = list.map((raw, i) => {
    const usable = typeof raw === 'string' && raw.length <= MAX_PATH_CHARS && fold(raw).length <= MAX_PATH_CHARS;
    const segs = usable ? split(raw) : [];
    const denied = !usable || denyListed(raw);
    const floor = denied ? [DENY_LIST] : [];
    const reads = usable ? readings(raw) : [[]];
    return {
      path: usable ? raw : '',
      denied,
      production: !isTest(segs),
      module: usable ? moduleOf(parts(raw), containers) : `/?${i}`,
      sensitive: [...hitsOf(sensitive, reads), ...floor],
      boundary: [...hitsOf(BOUNDARY, reads), ...floor],
      contract: hitsOf(CONTRACT, reads),
    };
  });
  const names = (key) => [...new Set(files.flatMap((f) => f[key]))].sort();
  return {
    files,
    production_files: files.filter((f) => f.production).length,
    modules: new Set(files.map((f) => f.module)).size,
    sensitive: names('sensitive'),
    boundary: names('boundary'),
    contract: names('contract'),
    refused: [...new Set(extra.refused)].sort(),
  };
}
