// quality/exports.mjs: a name a change exports from a module that the repository imports, when nothing imports that name. A module
// nothing imports may be an entry point or a package's public face, and one imported whole may use any name, so neither is held to it.
// It is advice.

import { report, overlaps } from './findings.mjs';

const field = (node, name) => node.childForFieldName(name);
const isDefault = (node) => node.children.some((c) => c.type === 'default');

// The names one export statement declares: export default, export function f, export const a = 1, b = 2, and export { a, b as c }.
function declared(node) {
  if (isDefault(node)) return [[node, 'default']];
  const declaration = field(node, 'declaration');
  const own = field(declaration ?? node, 'name');
  if (declaration && own) return [[declaration, own.text]];
  const variables = (declaration?.namedChildren ?? []).filter((c) => c.type === 'variable_declarator' && field(c, 'name')?.type === 'identifier');
  const clause = node.namedChildren.find((c) => c.type === 'export_clause')?.namedChildren ?? [];
  return [...variables.map((d) => [d, field(d, 'name').text]), ...clause.map((spec) => [spec, (field(spec, 'alias') ?? field(spec, 'name'))?.text])];
}

/** The names a change exported from a module at its top level, with their lines: [{ name, line }]. A re-export is not one. */
export function exportsAdded(tree, added) {
  const statements = tree.rootNode.namedChildren.filter((n) => n.type === 'export_statement' && !field(n, 'source') && overlaps(added, n.startPosition.row + 1, n.endPosition.row + 1));
  return statements.flatMap(declared).filter(([, name]) => name).map(([node, name]) => ({ name, line: node.startPosition.row + 1 }));
}

/** Advice for each name a change exported that no importer of the module takes. */
export function scoreExports(ctx, { file, names, importers }) {
  const users = importers.get(file) ?? [];
  if (users.length === 0 || users.some((e) => e.names === null)) return;
  const used = new Set(users.flatMap((e) => e.names));
  for (const { name, line } of names) if (!used.has(name)) report(ctx, { rule: 'unused-export', file, line, name, value: users.length, limit: 0 });
}
