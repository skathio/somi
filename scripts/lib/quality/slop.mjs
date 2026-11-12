// quality/slop.mjs: habits of hastily written code, looked for in what a change added. Each is cheap to see in the parse tree and each
// has an honest use now and then, so most are advice:
// - empty-catch: a catch that does nothing and does not say why. A comment inside is the why.
// - log-only-catch: a catch that only logs, so the failure carries on as if it had not happened.
// - rethrow-catch: a catch that throws the same error unchanged, which only adds nesting.
// - focused-test and skipped-test: .only, fit, .skip and xit left in a test file. A focused test silently stops the rest of the suite.
// - test-without-assertion: a test whose body asserts nothing, so it passes whatever the code does.
// - console and debugger: debugging output and breakpoints left in product code.
// - unused-binding: a local, or a trailing parameter, that nothing reads.
// - pass-through: a function that only calls another with the same arguments, which adds a name and no behaviour.

import { report, inAdded, overlaps } from './findings.mjs';

const field = (node, name) => node.childForFieldName(name);
const lineOf = (node) => node.startPosition.row + 1;
const FUNCTIONS = new Set(['function_declaration', 'function_expression', 'function', 'arrow_function', 'method_definition', 'generator_function_declaration', 'generator_function']);
const CONSOLE = /^console\.(log|debug|trace|dir|table)$/;
const LOGGER = /^(console|logger|log|this\.logger|this\.log)\.\w+$/;
const FOCUSED = /^(describe|it|test|context|suite|specify)\.only$|^(fit|fdescribe|ftest)$/;
const SKIPPED = /^(describe|it|test|context|suite|specify)\.skip$|^(xit|xdescribe|xtest|xcontext)$/;
const TEST = /^(it|test|specify)(\.(only|concurrent|sequential|serial))?$/;
const ASSERTION = /\b(expect|assert|should)\b|(^|\.)(expect|assert|should|verify|ensure|check)\w*$|^(t|st|tt)\.[\w.]+$|\.(to\w*|throws|rejects|resolves|matchSnapshot)$/i;

// Every node of a type under `node`.
function nodes(node, types, out = []) {
  if (types.has(node.type)) out.push(node);
  for (const c of node.namedChildren) nodes(c, types, out);
  return out;
}

// The nodes of some types that start on a line the change added.
const addedNodes = (tree, types, added) => nodes(tree.rootNode, new Set(types)).filter((n) => inAdded(added, lineOf(n)));
const flag = (ctx, file, node, rule) => report(ctx, { rule, file, line: lineOf(node), value: 1, limit: 0 });

const statements = (block) => (block ? block.namedChildren.filter((c) => c.type !== 'comment') : []);
const calleeText = (call) => field(call, 'function')?.text.replace(/\s+/g, '') ?? '';

function catchRule(clause) {
  const body = field(clause, 'body') ?? clause.namedChildren.find((c) => c.type === 'block');
  const inside = statements(body);
  if (inside.length === 0) return body?.namedChildren.length ? null : 'empty-catch';
  if (inside.length !== 1) return null;
  const [only] = inside;
  const call = only.type === 'expression_statement' ? only.namedChildren[0] : null;
  if (call?.type === 'call_expression' && LOGGER.test(calleeText(call))) return 'log-only-catch';
  const declaration = clause.namedChildren.find((c) => c.type === 'catch_declaration');
  const param = field(clause, 'parameter') ?? (declaration && field(declaration, 'name'));
  const thrown = only.type === 'throw_statement' ? only.namedChildren.filter((c) => c.type !== 'comment') : null;
  return thrown && (thrown.length === 0 || (param && thrown[0].text === param.text)) ? 'rethrow-catch' : null;
}

function scoreCatches(ctx, { file, tree, added }) {
  for (const clause of addedNodes(tree, ['catch_clause'], added)) {
    const rule = catchRule(clause);
    if (rule) flag(ctx, file, clause, rule);
  }
}

// A test is a call of it or test with a function as its body. Assertions in a helper it calls are not seen, which is why this is advice.
function scoreTests(ctx, { file, tree, added }) {
  for (const call of addedNodes(tree, ['call_expression'], added)) {
    const callee = calleeText(call);
    if (FOCUSED.test(callee)) flag(ctx, file, call, 'focused-test');
    if (SKIPPED.test(callee)) flag(ctx, file, call, 'skipped-test');
    const body = TEST.test(callee) ? field(call, 'arguments')?.namedChildren.find((a) => FUNCTIONS.has(a.type)) : null;
    if (body && !nodes(body, new Set(['call_expression'])).some((c) => ASSERTION.test(calleeText(c)))) flag(ctx, file, call, 'test-without-assertion');
  }
}

function scoreDebugging(ctx, { file, tree, added }) {
  for (const node of addedNodes(tree, ['call_expression', 'debugger_statement'], added)) {
    if (node.type === 'debugger_statement') flag(ctx, file, node, 'debugger');
    else if (CONSOLE.test(calleeText(node))) flag(ctx, file, node, 'console');
  }
}

// The simple names a function takes, in order: a, b = 1, and TypeScript's a: T. A destructured parameter is null.
function paramNames(fn) {
  const params = field(fn, 'parameters')?.namedChildren.filter((c) => c.type !== 'comment') ?? (field(fn, 'parameter') ? [field(fn, 'parameter')] : []);
  return params.map((p) => {
    const name = p.type === 'identifier' ? p : field(p, 'pattern') ?? field(p, 'left');
    return name?.type === 'identifier' ? name : null;
  });
}

// How often each name is read inside a function, nested functions included, counting every identifier with its text.
function reads(fn) {
  const counts = new Map();
  for (const id of nodes(fn, new Set(['identifier', 'shorthand_property_identifier']))) counts.set(id.text, (counts.get(id.text) ?? 0) + 1);
  return counts;
}

// The locals a function declares itself, not those of a function nested in it.
function locals(fn) {
  const out = [];
  const visit = (n) => {
    if (n !== fn && FUNCTIONS.has(n.type)) return;
    if (n.type === 'variable_declarator' && field(n, 'name')?.type === 'identifier') out.push(field(n, 'name'));
    for (const c of n.namedChildren) visit(c);
  };
  visit(fn);
  return out;
}

function scoreBindings(ctx, { file, fn, added }) {
  const counts = reads(fn);
  const unread = (id) => id && !id.text.startsWith('_') && (counts.get(id.text) ?? 0) <= 1 && inAdded(added, lineOf(id));
  const params = paramNames(fn);
  // A parameter before one that is read holds its place, so only those after the last read one are unused.
  const lastRead = params.findLastIndex((p) => p === null || !unread(p));
  const unused = counts.has('arguments') || !field(fn, 'body') ? [] : params.slice(lastRead + 1);
  for (const id of [...unused, ...locals(fn).filter(unread)]) report(ctx, { rule: 'unused-binding', file, line: lineOf(id), name: id.text, value: 0, limit: 1 });
}

// A named function whose whole body is a call of another with its own parameters, in order.
function passThrough(fn) {
  if (!['function_declaration', 'arrow_function', 'function_expression'].includes(fn.type)) return false;
  if (fn.type !== 'function_declaration' && fn.parent?.type !== 'variable_declarator') return false;
  const body = field(fn, 'body');
  const only = body?.type === 'statement_block' ? statements(body) : [body];
  const returned = only.length === 1 && only[0]?.type === 'return_statement' ? only[0].namedChildren[0] : only[0];
  const call = returned?.type === 'await_expression' ? returned.namedChildren[0] : returned;
  if (call?.type !== 'call_expression' || calleeText(call) === 'super') return false;
  const args = field(call, 'arguments')?.namedChildren.filter((c) => c.type !== 'comment') ?? [];
  const params = paramNames(fn);
  return params.length > 0 && params.every(Boolean) && args.length === params.length && args.every((a, i) => a.type === 'identifier' && a.text === params[i].text);
}

function scoreFunctions(ctx, { file, tree, added }) {
  for (const fn of nodes(tree.rootNode, FUNCTIONS)) {
    if (!overlaps(added, lineOf(fn), fn.endPosition.row + 1)) continue;
    scoreBindings(ctx, { file, fn, added });
    if (inAdded(added, lineOf(fn)) && passThrough(fn)) flag(ctx, file, fn, 'pass-through');
  }
}

/** Every habit above in what a change added to one file. C# is checked for its catches only. */
export function scoreSlop(ctx, { file, tree, added, language, test }) {
  scoreCatches(ctx, { file, tree, added });
  if (language === 'c-sharp') return;
  if (test) return scoreTests(ctx, { file, tree, added });
  scoreDebugging(ctx, { file, tree, added });
  scoreFunctions(ctx, { file, tree, added });
}
