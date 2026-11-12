// quality/imports.mjs: which files of the repository a JavaScript or TypeScript file imports, and which of their names. It reads the
// text, not a parse tree, so the whole repository can be read in the time a gate has: static import and export-from statements,
// require() and import() of a literal path. Only relative paths are followed, since a package or an alias is not a file of this
// repository. Type-only imports are kept apart, because they do not exist when the code runs and so cannot make a cycle.

import path from 'node:path';

const FROM = /^[ \t]*(import|export)\s+(type\s+)?([^;'"`]*?)\s*from\s*['"]([^'"\n]+)['"]/gm;
const BARE = /^[ \t]*import\s*['"]([^'"\n]+)['"]/gm;
const CALL = /\b(?:require|import)\(\s*['"]([^'"\n]+)['"]\s*\)/g;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
// TypeScript written for ESM imports './x.js' for the file x.ts.
const SOURCE_FOR = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };

// The names an import clause takes: null for all of them (a namespace, export *, or anything not spelled out).
function namesOf(kind, clause) {
  if (/(^|,)\s*\*/.test(clause)) return null;
  const names = [];
  const braces = /\{([^}]*)\}/.exec(clause);
  const outside = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
  if (kind === 'import' && outside && outside !== 'type') names.push('default');
  for (const part of braces ? braces[1].split(',') : []) {
    const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
    if (name) names.push(name);
  }
  return names;
}

const typeOnly = (kind, type, clause) => Boolean(type) || (/^\{[^}]*\}$/.test(clause.trim()) && clause.replace(/[{}]/g, '').split(',').every((p) => /^\s*type\s/.test(p) || !p.trim()));

/** [{ spec, names, typeOnly }] for every import of a file's text. names is null when the import may use any name. */
export function importsOf(text) {
  const out = [];
  for (const m of text.matchAll(FROM)) out.push({ spec: m[4], names: namesOf(m[1], m[3]), typeOnly: typeOnly(m[1], m[2], m[3]) });
  for (const m of text.matchAll(BARE)) out.push({ spec: m[1], names: [], typeOnly: false });
  for (const m of text.matchAll(CALL)) out.push({ spec: m[1], names: null, typeOnly: false });
  return out;
}

/** The repository file a relative import names, or null for a package, an alias, or a file that is not there. */
export function resolveImport(spec, from, files) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(from), spec);
  const ext = path.posix.extname(base);
  const swapped = (SOURCE_FOR[ext] ?? []).map((e) => base.slice(0, -ext.length) + e);
  const candidates = [base, ...swapped, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => `${base}/index${e}`)];
  return candidates.find((c) => files.has(c)) ?? null;
}

/** A Map from each file to its edges [{ to, names, typeOnly }], for the files whose texts are given. */
export function importGraph(texts, files) {
  const graph = new Map();
  for (const [file, text] of texts) {
    const edges = [];
    for (const imp of importsOf(text)) {
      const to = resolveImport(imp.spec, file, files);
      if (to && to !== file) edges.push({ to, names: imp.names, typeOnly: imp.typeOnly });
    }
    graph.set(file, edges);
  }
  return graph;
}
