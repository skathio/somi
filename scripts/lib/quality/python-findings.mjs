// quality/python-findings.mjs: what the gate reads from one Python file's tree alone: leftover debugging and a swallowed error, under
// the rule names the other languages use, so findings.mjs decides what fails. A debugger and a catch-all that does nothing fail. print
// (console) and passing on one named exception (empty-catch) are advice: the calibration on known-good Python projects
// (benchmarks/quality/records/) found print is also how a command-line tool talks, and passing on one named exception is often meant.

// breakpoint(), and set_trace() however pdb, ipdb or pudb was imported: pdb.set_trace(), from pdb import set_trace, import pdb as p.
const DEBUGGER = /^(breakpoint|set_trace|[\w.]+\.set_trace)$/;
const BROAD = /\b(BaseException|Exception)\b/;
const EXCEPT = new Set(['except_clause', 'except_group_clause']);
const PASSES = new Set(['pass_statement', 'comment']);

export const field = (node, name) => node.childForFieldName(name);
export const line = (node) => node.startPosition.row + 1;
const isEllipsis = (n) => n.type === 'expression_statement' && n.namedChildCount === 1 && n.namedChildren[0].type === 'ellipsis';

function debugCall(node, test) {
  const callee = field(node, 'function')?.text ?? '';
  if (DEBUGGER.test(callee)) return { rule: 'debugger', level: 'violation', line: line(node), name: callee };
  if (callee === 'print' && !test) return { rule: 'console', level: 'warning', line: line(node), name: 'print' };
  return null;
}

// An except that does nothing hides the failure. Catching everything that way fails, a broad type anywhere in a tuple included;
// passing on one named exception is advice.
function swallowed(node, test) {
  const body = node.namedChildren.find((c) => c.type === 'block');
  if (!body || !body.namedChildren.every((c) => PASSES.has(c.type) || isEllipsis(c))) return null;
  const caught = node.namedChildren.find((c) => c.type !== 'block' && c.type !== 'comment');
  // `except (A, B) as e` names the types in the pattern's first child; the alias is not a type.
  const types = caught?.type === 'as_pattern' ? caught.namedChildren[0]?.text ?? '' : caught?.text ?? '';
  const name = caught ? caught.text.slice(0, 60) : 'except';
  if (!caught || BROAD.test(types)) return { rule: 'swallowed-error', level: 'violation', line: line(node), name };
  return test ? null : { rule: 'empty-catch', level: 'warning', line: line(node), name };
}

// The names an import binds: import a.b binds a, import a.b as c binds c, from x import y binds y. A star import binds nothing we can
// see, and from __future__ is an instruction to the compiler, not a name.
function importedNames(node) {
  if (node.type === 'import_from_statement' && field(node, 'module_name')?.text === '__future__') return [];
  const module = field(node, 'module_name')?.startIndex;
  const names = node.type === 'import_from_statement' ? node.namedChildren.filter((c) => c.startIndex !== module) : node.namedChildren;
  return names.flatMap((c) => {
    // import x as x and from x import y as y are PEP 484's way to say a name is re-exported on purpose.
    if (c.type === 'aliased_import') return field(c, 'name')?.text === field(c, 'alias')?.text ? [] : [field(c, 'alias') ?? c.namedChildren.at(-1)];
    return c.type === 'dotted_name' ? [c.namedChildren[0] ?? c] : [];
  }).filter(Boolean);
}

// An import nothing in the file uses: no identifier outside the imports reads it, and no string names it, which covers __all__ and a
// type written as a string. A package's __init__.py imports to re-export, so it is not read, and neither is an import marked noqa. Advice, as unused-binding is elsewhere.
function unusedImports(root) {
  const imports = [];
  const used = new Set();
  const strings = [];
  const visit = (n, inImport) => {
    const here = inImport || n.type === 'import_statement' || n.type === 'import_from_statement';
    const quiet = n.nextSibling?.type === 'comment' && n.nextSibling.startPosition.row === n.endPosition.row && /noqa/.test(n.nextSibling.text);
    if ((n.type === 'import_statement' || n.type === 'import_from_statement') && !quiet) imports.push(...importedNames(n));
    if (!here && n.type === 'identifier') used.add(n.text);
    if (n.type === 'string') strings.push(n.text);
    for (const c of n.namedChildren) visit(c, here);
  };
  visit(root, false);
  const named = (name) => strings.some((t) => new RegExp(`\\b${name}\\b`).test(t));
  return imports.filter((id) => !used.has(id.text) && !named(id.text)).map((id) => ({ rule: 'unused-import', level: 'warning', line: line(id), name: id.text }));
}

/**
 * Leftover debugging, swallowed errors and unused imports in one file: [{ rule, level, line, name }]. reexports is true for a package's
 * __init__.py, whose imports are its interface. A test may print and may pass on one named error,
 * but a debugger stops the suite and a catch-all that does nothing hides what failed, in a test as anywhere.
 */
export function pythonFindings(tree, { test = false, reexports = false } = {}) {
  const out = [];
  const visit = (n) => {
    const found = n.type === 'call' ? debugCall(n, test) : EXCEPT.has(n.type) ? swallowed(n, test) : null;
    if (found) out.push(found);
    for (const c of n.namedChildren) visit(c);
  };
  visit(tree.rootNode);
  return reexports ? out : [...out, ...unusedImports(tree.rootNode)];
}
