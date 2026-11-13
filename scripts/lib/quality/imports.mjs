// quality/imports.mjs: which files of the repository a JavaScript or TypeScript file imports, and which of their names. It reads the
// text, not a parse tree, so the whole repository can be read in the time a gate has: static import and export-from statements,
// require() and import() of a literal path. Relative paths are followed, and so are the aliases a root tsconfig.json or jsconfig.json
// declares under compilerOptions.paths and baseUrl. A package is not a file of this repository, so it is not followed. Type-only imports are kept apart, because they do not exist when the code runs and so cannot make a cycle.

import path from 'node:path';
import { codeOnly } from './js-source.mjs';
import { aliased } from './path-aliases.mjs';

export { codeOnly } from './js-source.mjs';
export { aliasesFrom } from './path-aliases.mjs';

// A statement is found by its keyword, and its clause is the text up to the next quote, at most MAX_CLAUSE characters on. The clause
// must have the shape of an import clause, so an `export type A = {` cannot swallow the import on the line after it. Every pattern
// here is anchored and bounded, so a hostile file costs the same as an ordinary one.
const STATEMENT = /^[ \t]*(import|export)\b/gm;
const MAX_CLAUSE = 1000;
const CLAUSES = {
  import: /^\s*(type\s+)?((?:[\w$]+\s*,\s*)?(?:\{[^{}]*\}|\*\s*as\s+[\w$]+)|[\w$]+)\s*from\s*$/,
  export: /^\s*(type\s+)?(\{[^{}]*\}|\*(?:\s*as\s+[\w$]+)?)\s*from\s*$/,
};
const SPEC = /^(['"])([^'"\n]+)\1/;
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

function fromStatement(text, m) {
  const start = m.index + m[0].length;
  const window = text.slice(start, start + MAX_CLAUSE);
  const quote = window.search(/['"`]/);
  const clause = quote < 0 ? null : CLAUSES[m[1]].exec(window.slice(0, quote));
  const spec = clause ? SPEC.exec(window.slice(quote)) : null;
  return spec ? { spec: spec[2], names: namesOf(m[1], clause[2]), typeOnly: typeOnly(m[1], clause[1], clause[2]) } : null;
}

/** [{ spec, names, typeOnly }] for every import of a file's text. names is null when the import may use any name. */
export function importsOf(source) {
  const text = codeOnly(source);
  const out = [];
  for (const m of text.matchAll(STATEMENT)) { const found = fromStatement(text, m); if (found) out.push(found); }
  for (const m of text.matchAll(BARE)) out.push({ spec: m[1], names: [], typeOnly: false });
  for (const m of text.matchAll(CALL)) out.push({ spec: m[1], names: null, typeOnly: false });
  return out;
}

/** The repository file an import names: a relative path, or an alias of the root tsconfig. Null for a package or a file not there. */
export function resolveImport(spec, from, files, aliases = []) {
  if (!spec.startsWith('.')) return aliased(spec, aliases).map((base) => candidatesFor(base).find((c) => files.has(c))).find(Boolean) ?? null;
  return candidatesFor(path.posix.join(path.posix.dirname(from), spec)).find((c) => files.has(c)) ?? null;
}

function candidatesFor(base) {
  const ext = path.posix.extname(base);
  const swapped = (SOURCE_FOR[ext] ?? []).map((e) => base.slice(0, -ext.length) + e);
  return [base, ...swapped, ...EXTENSIONS.map((e) => base + e), ...EXTENSIONS.map((e) => `${base}/index${e}`)];
}

/** A Map from each file to its edges [{ to, names, typeOnly }], for the files whose texts are given. */
export function importGraph(texts, files, aliases = []) {
  const graph = new Map();
  for (const [file, text] of texts) {
    const edges = [];
    for (const imp of importsOf(text)) {
      const to = resolveImport(imp.spec, file, files, aliases);
      if (to && to !== file) edges.push({ to, names: imp.names, typeOnly: imp.typeOnly });
    }
    graph.set(file, edges);
  }
  return graph;
}
