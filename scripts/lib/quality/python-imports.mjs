// quality/python-imports.mjs: what a Python file imports, and whether another file uses a name a module offers. An absolute import is
// matched against the end of a file's path, because the gate does not know the import roots.

import { field } from './python-findings.mjs';

const dotted = (file) => file.replace(/\.py$/i, '').replace(/\/__init__$/, '').split('/').filter(Boolean);
const endsWith = (whole, tail) => tail.length > 0 && tail.length <= whole.length && tail.every((part, i) => whole[whole.length - tail.length + i] === part);

// The module an import names, as path parts. A relative import counts up from the importing file's own package.
function importedModule(node, importer) {
  const module = field(node, 'module_name');
  if (module?.type !== 'relative_import') return { parts: module ? module.text.split('.') : [], absolute: true };
  const level = module.namedChildren.find((c) => c.type === 'import_prefix')?.text.length ?? 1;
  const base = importer.split('/').slice(0, -1);
  const name = module.namedChildren.find((c) => c.type === 'dotted_name')?.text.split('.') ?? [];
  return { parts: [...base.slice(0, base.length - (level - 1)), ...name], absolute: false };
}

const importedName = (node) => (node.type === 'aliased_import' ? field(node, 'name')?.text : node.text) ?? '';

/**
 * What one file imports: [{ parts, absolute, names, star }] for each `from x import a, b`, and { parts, absolute: true, whole: true }
 * for each `import x.y`. parts is the module as path parts, resolved against the importing file for a relative import.
 */
export function importsOf(tree, importer) {
  const out = [];
  const visit = (n) => {
    if (n.type === 'import_from_statement') {
      const module = field(n, 'module_name');
      const named = n.namedChildren.filter((c) => !module || c.startIndex !== module.startIndex);
      out.push({ ...importedModule(n, importer), names: named.filter((c) => c.type !== 'wildcard_import').map(importedName), star: named.some((c) => c.type === 'wildcard_import') });
      return;
    }
    if (n.type === 'import_statement') { for (const c of n.namedChildren) out.push({ parts: importedName(c).split('.'), absolute: true, whole: true }); return; }
    for (const c of n.namedChildren) visit(c);
  };
  visit(tree.rootNode);
  return out;
}

// An absolute import names a module from some root the gate does not know (src/, the repository, an installed name), so it matches a
// file when it is the end of the file's path. A relative one was resolved from the importer, so it must be the whole path.
const names = (imp, target) => (imp.absolute ? endsWith(target, imp.parts) : imp.parts.join('/') === target.join('/'));
// A name can come from the text of an __all__ string, which is repository content, so it is matched literally.
export const literal = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether another file uses `name` from the module at `file`: it imports the name, imports everything, or imports the module and
 * reaches the name through it. `others` is [{ file, text, imports }].
 */
export function isImported(file, name, others) {
  const target = dotted(file);
  const through = new RegExp(`\\.${literal(name)}\\b`);
  return others.some((o) => o.file !== file && o.imports.some((imp) => {
    if (imp.whole) return names(imp, target) && through.test(o.text);
    if (names(imp, target)) return imp.star || imp.names.includes(name);
    // `from pkg import util` brings the module itself, and the name is then reached as util.name.
    return imp.names.some((n) => names({ ...imp, parts: [...imp.parts, n] }, target)) && through.test(o.text);
  }));
}
