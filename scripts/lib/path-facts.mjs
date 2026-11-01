// path-facts.mjs — classifyPaths(paths, config): what kind of change do these model-named paths describe?
//
// Pure string work: no filesystem call and no file content, so no result can carry any. The caller has already
// refused unsafe paths at path-safety's door; this module only classifies names. Per path it returns
//   { path, denied, production, module, sensitive: [names], boundary: [names], contract: [names] }
// and over the list { files, production_files, modules, sensitive, boundary, contract } (names sorted, unique).
// A denied name (path-safety's deny list) is a hit on the built-in `deny_list` name in the sensitive and boundary
// lists whatever the config says, so the floor it carries survives a refusal elsewhere.
//
// Config only adds: `sizing.sensitive_paths` globs are appended to the built-ins and `sizing.module_containers`
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
// what is under it. Cost is bounded by the caps on glob count and length and on path length.
import { MAX_PATHS, MAX_PATH_CHARS, denyListed } from './path-safety.mjs';

export const MAX_GLOBS = 32;
export const MAX_GLOB_CHARS = 100;
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

const fold = (s) => s.normalize('NFKC').toUpperCase().toLowerCase();
// Separators only, no folding: the module key keeps the case a case-sensitive filesystem tells apart.
const parts = (s) => s.split(/[\\/]+/).filter((x) => x !== '' && x !== '.');
const split = (s) => parts(fold(s));
// A path segment loses trailing dots and spaces as path-safety's deny test does, so `package.json.` is the manifest.
const pathSegs = (raw) => split(raw).map((x) => x.replace(/[. ]+$/, '')).filter(Boolean);
// Adjacent `**` mean one, so a glob of many of them costs one step.
const compile = (glob) => (/[\\/]/.test(glob) ? split(glob) : ['**', ...split(glob)]).filter((p, i, all) => !(p === '**' && all[i - 1] === '**'));
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

const hitsOf = (rules, segs) => rules.filter(([, globs]) => globs.some((g) => globMatches(g, segs))).map(([name]) => name);
const isTest = (segs) => segs.slice(0, -1).some((s) => TEST_DIRS.has(s)) || TEST_FILES.some((g) => segMatch(g, segs.at(-1) ?? ''));
// A container's children are modules (`packages/a`), never the bare child, so one name under two containers is two
// modules; a file directly in a container, or at the root, belongs to the container, or to the root's one module.
const moduleOf = (raw, containers) => {
  if (raw.length < 2) return '';
  return containers.has(pathSegs(raw[0])[0]) && raw.length > 2 ? `${raw[0]}/${raw[1]}` : raw[0];
};

const field = (o, k) => (o !== null && typeof o === 'object' && !Array.isArray(o) && Object.hasOwn(o, k) ? o[k] : undefined);
// Shape checks on the text as written: a glob never reaches the filesystem, so `..` and absolute only need refusing.
const validGlob = (g) => !/[\p{C}\p{Zl}\p{Zp}]/u.test(g) && !/^(?:[\\/]|[a-z]:)/i.test(g) && !g.includes('..') && split(g).length > 0;
// A container is exactly one plain segment (`services/` and `./services` are `services`); anything else is no container.
const containerName = (g) => { const s = split(g); return s.length === 1 && !/[*?]/.test(s[0]) ? s[0] : null; };
const bounded = (v, ok) => Array.isArray(v) && v.length <= MAX_GLOBS && v.every((g) => typeof g === 'string' && g.length > 0 && g.length <= MAX_GLOB_CHARS && ok(g));

// The additions of every layer; a key that is invalid adds nothing, and no layer or key affects another's.
function additions(layers) {
  const out = { sensitive: [], containers: [] };
  for (const layer of Array.isArray(layers) ? layers : [layers]) {
    const sizing = field(layer, 'sizing');
    const globs = field(sizing, 'sensitive_paths') ?? [];
    const names = field(sizing, 'module_containers') ?? [];
    if (bounded(globs, validGlob)) out.sensitive.push(...globs.map(compile));
    if (bounded(names, (g) => validGlob(g) && containerName(g))) out.containers.push(...names.map(containerName));
  }
  return out;
}

export function classifyPaths(paths, layers) {
  const extra = additions(layers);
  const sensitive = [...SENSITIVE, ['config', extra.sensitive]];
  const containers = new Set([...BUILTIN_CONTAINERS, ...extra.containers]);
  // A list that is not an array, or is over the count cap, is MAX_PATHS unusable entries: it floors instead of vanishing.
  // An unusable entry is a module of its own (`?<index>`), so the counts are the largest the cap allows.
  const list = Array.isArray(paths) && paths.length <= MAX_PATHS ? paths : Array(MAX_PATHS).fill(null);
  const files = list.map((raw, i) => {
    const usable = typeof raw === 'string' && raw.length <= MAX_PATH_CHARS;
    const segs = usable ? pathSegs(raw) : [];
    const denied = !usable || denyListed(raw);
    const floor = denied ? [DENY_LIST] : [];
    return {
      path: usable ? raw : '',
      denied,
      production: !isTest(segs),
      module: usable ? moduleOf(parts(raw), containers) : `?${i}`,
      sensitive: [...hitsOf(sensitive, segs), ...floor],
      boundary: [...hitsOf(BOUNDARY, segs), ...floor],
      contract: hitsOf(CONTRACT, segs),
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
  };
}
