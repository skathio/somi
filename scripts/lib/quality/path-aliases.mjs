// quality/path-aliases.mjs: the import aliases a root tsconfig.json or jsconfig.json declares under compilerOptions.paths and baseUrl,
// and the repository paths an aliased import may name. The config is JSON with comments and trailing commas, so its comments are blanked
// the way source comments are and its trailing commas dropped before it is parsed. Anything that cannot be read declares no alias.

import path from 'node:path';
import { codeOnly } from './js-source.mjs';

const MAX_ALIASES = 100;
const pattern = (p) => { const star = p.indexOf('*'); return star === -1 ? { prefix: p, suffix: null } : { prefix: p.slice(0, star), suffix: p.slice(star + 1) }; };

/** The path aliases a tsconfig.json or jsconfig.json declares: [{ prefix, suffix, targets }], or [] when it has none or cannot be read. */
export function aliasesFrom(text) {
  let options;
  try { options = JSON.parse(codeOnly(text).replace(/,(\s*[}\]])/g, '$1'))?.compilerOptions; } catch { return []; }
  if (!options || typeof options !== 'object') return [];
  const base = typeof options.baseUrl === 'string' ? path.posix.normalize(options.baseUrl) : '.';
  const paths = options.paths && typeof options.paths === 'object' ? Object.entries(options.paths) : [];
  const out = paths.filter(([, to]) => Array.isArray(to)).slice(0, MAX_ALIASES)
    .map(([from, to]) => ({ ...pattern(from), targets: to.filter((t) => typeof t === 'string').map((t) => ({ ...pattern(path.posix.join(base, t)) })) }));
  // baseUrl alone lets 'src/x' name the file src/x from the configured root, as a catch-all after the declared aliases.
  if (typeof options.baseUrl === 'string') out.push({ prefix: '', suffix: '', targets: [{ prefix: base === '.' ? '' : `${base}/`, suffix: '' }] });
  return out;
}

// The paths an aliased import may name, in the order TypeScript tries them.
export function aliased(spec, aliases) {
  for (const a of aliases) {
    if (a.suffix === null) { if (spec === a.prefix) return a.targets.map((t) => t.prefix); continue; }
    if (!spec.startsWith(a.prefix) || !spec.endsWith(a.suffix) || spec.length < a.prefix.length + a.suffix.length) continue;
    const star = spec.slice(a.prefix.length, spec.length - a.suffix.length);
    const hits = a.targets.map((t) => (t.suffix === null ? t.prefix : `${t.prefix}${star}${t.suffix}`)).map((p) => path.posix.normalize(p));
    if (hits.length > 0) return hits;
  }
  return [];
}

