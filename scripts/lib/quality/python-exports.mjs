// quality/python-exports.mjs: what a Python module offers to other files, read from its tree.

import { field, line } from './python-findings.mjs';

const DEFINITIONS = new Set(['function_definition', 'class_definition']);

const strings = (node) => node.namedChildren.filter((c) => c.type === 'string').map((c) => ({ name: c.namedChildren.find((p) => p.type === 'string_content')?.text ?? '', line: line(c) }));

// The names __all__ lists, from every assignment to it at the top of the file, or null when the file has none.
function declaredAll(root) {
  let all = null;
  for (const statement of root.namedChildren.filter((c) => c.type === 'expression_statement')) {
    const assign = statement.namedChildren[0];
    if (!assign || !['assignment', 'augmented_assignment'].includes(assign.type) || field(assign, 'left')?.text !== '__all__') continue;
    const right = field(assign, 'right');
    all = [...(all ?? []), ...(right && ['list', 'tuple'].includes(right.type) ? strings(right) : [])];
  }
  return all;
}

/**
 * What a module offers to others: the names in __all__ when it has one, or else its top-level functions and classes whose name has no
 * leading underscore. A decorated definition is left out, because a decorator often registers it somewhere, so nothing imports it.
 * [{ name, line, declared }], where declared says the name came from __all__.
 */
export function exportsOf(tree) {
  const root = tree.rootNode;
  const all = declaredAll(root);
  if (all) return all.filter((x) => x.name !== '' && !x.name.startsWith('_')).map((x) => ({ ...x, declared: true }));
  return root.namedChildren.filter((c) => DEFINITIONS.has(c.type)).map((c) => ({ name: field(c, 'name')?.text ?? '', line: line(c), declared: false })).filter((x) => x.name !== '' && !x.name.startsWith('_'));
}
