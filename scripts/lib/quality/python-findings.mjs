// quality/python-findings.mjs: what the gate reads from one Python file's tree alone: leftover debugging and a swallowed error. The
// rules were calibrated on known-good Python projects (benchmarks/quality/records/), which is why some of them only warn: print is also
// how a command-line tool talks, and passing on one named exception is often meant.

const DEBUGGERS = new Set(['pdb.set_trace', 'ipdb.set_trace', 'pudb.set_trace']);
const BROAD = /^\(?\s*(BaseException|Exception)\b/;
const PASSES = new Set(['pass_statement', 'comment']);

export const field = (node, name) => node.childForFieldName(name);
export const line = (node) => node.startPosition.row + 1;
const isEllipsis = (n) => n.type === 'expression_statement' && n.namedChildCount === 1 && n.namedChildren[0].type === 'ellipsis';

function debugCall(node) {
  const callee = field(node, 'function');
  if (callee?.type === 'identifier' && callee.text === 'breakpoint') return { rule: 'debug', level: 'violation', line: line(node), name: 'breakpoint' };
  if (callee?.type === 'attribute' && DEBUGGERS.has(callee.text)) return { rule: 'debug', level: 'violation', line: line(node), name: callee.text };
  if (callee?.type === 'identifier' && callee.text === 'print') return { rule: 'debug', level: 'warning', line: line(node), name: 'print' };
  return null;
}

// An except that does nothing hides the failure. Catching everything that way is a violation; passing on one named exception warns.
function swallowed(node) {
  const body = node.namedChildren.find((c) => c.type === 'block');
  if (!body || !body.namedChildren.every((c) => PASSES.has(c.type) || isEllipsis(c))) return null;
  const caught = node.namedChildren.find((c) => c.type !== 'block' && c.type !== 'comment');
  const broad = !caught || BROAD.test(caught.text);
  return { rule: 'swallowed-error', level: broad ? 'violation' : 'warning', line: line(node), name: caught ? caught.text.slice(0, 60) : 'except' };
}

/** Leftover debugging and swallowed errors in one file: [{ rule, level, line, name }]. Tests may print and may pass on an error. */
export function pythonFindings(tree, { test = false } = {}) {
  if (test) return [];
  const out = [];
  const visit = (n) => {
    const found = n.type === 'call' ? debugCall(n) : n.type === 'except_clause' ? swallowed(n) : null;
    if (found) out.push(found);
    for (const c of n.namedChildren) visit(c);
  };
  visit(tree.rootNode);
  return out;
}
