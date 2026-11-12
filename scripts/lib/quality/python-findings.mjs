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

/**
 * Leftover debugging and swallowed errors in one file: [{ rule, level, line, name }]. A test may print and may pass on one named error,
 * but a debugger stops the suite and a catch-all that does nothing hides what failed, in a test as anywhere.
 */
export function pythonFindings(tree, { test = false } = {}) {
  const out = [];
  const visit = (n) => {
    const found = n.type === 'call' ? debugCall(n, test) : EXCEPT.has(n.type) ? swallowed(n, test) : null;
    if (found) out.push(found);
    for (const c of n.namedChildren) visit(c);
  };
  visit(tree.rootNode);
  return out;
}
