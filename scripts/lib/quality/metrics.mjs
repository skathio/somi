// quality/metrics.mjs: per-function structure of JavaScript, TypeScript, C# and Python, from a tree-sitter tree. SoMi-CC v1 follows SonarSource's
// cognitive complexity: +1 for each break in linear flow, plus the nesting level for one that is nested, +1 per sequence of like
// boolean operators, +1 for recursion, and nothing for shorthand such as ?? or ?. . It deviates in one way, written down so nobody
// reads it as Sonar parity: a function nested in another is scored as its own unit, starting at the control-flow nesting around the
// point where it is defined. Sonar folds it into the outer function, which would score a test file's describe block as one function.

// The C# and Python grammars' node types sit beside the JavaScript ones. An else-if in C# is an if_statement held directly as the
// alternative. Python holds every elif and the else as alternatives of the one if, catches with except, and branches with match.
const FUNCTIONS = new Set(['function_declaration', 'function_expression', 'function', 'arrow_function', 'method_definition', 'generator_function_declaration', 'generator_function',
  'method_declaration', 'constructor_declaration', 'destructor_declaration', 'operator_declaration', 'conversion_operator_declaration', 'local_function_statement', 'lambda_expression', 'anonymous_method_expression',
  'function_definition', 'lambda']);
const LOOPS = new Set(['for_statement', 'for_in_statement', 'for_of_statement', 'while_statement', 'do_statement', 'foreach_statement']);
const TERNARY = new Set(['ternary_expression', 'conditional_expression', 'switch_expression']);
const DEPTH = new Set(['if_statement', 'switch_statement', 'match_statement', 'try_statement', ...LOOPS]);
const CATCHES = new Set(['catch_clause', 'except_clause', 'except_group_clause']);
const NOT_A_PARAMETER = new Set(['comment', 'positional_separator', 'keyword_separator']);
// Python parameters a caller may leave out. Together they do the work of one options object in JavaScript, so they count as one.
const OPTIONAL_PARAMETER = new Set(['default_parameter', 'typed_default_parameter', 'list_splat_pattern', 'dictionary_splat_pattern']);
const BOOLEAN = new Set(['&&', '||']);
const JSX = new Set(['jsx_element', 'jsx_self_closing_element', 'jsx_fragment']);

const field = (node, name) => node.childForFieldName(name);
const same = (a, b) => Boolean(a && b) && a.startIndex === b.startIndex && a.endIndex === b.endIndex && a.type === b.type;
const isElseIf = (node) => node.type === 'if_statement' && (node.parent?.type === 'else_clause' || same(node, field(node.parent, 'alternative')));
const operator = (node) => field(node, 'operator')?.type ?? node.children.find((c) => !c.isNamed && BOOLEAN.has(c.type))?.type;

function nameOf(node) {
  const own = field(node, 'name');
  if (own) return own.text;
  const p = node.parent;
  if (p?.type === 'variable_declarator') return field(p, 'name')?.text ?? null;
  if (p?.type === 'pair') return field(p, 'key')?.text ?? null;
  if (p?.type === 'assignment_expression' || p?.type === 'assignment') return field(p, 'left')?.text ?? null;
  if (p?.type === 'public_field_definition' || p?.type === 'field_definition') return field(p, 'property')?.text ?? field(p, 'name')?.text ?? null;
  return null;
}

function paramCount(node) {
  if (field(node, 'parameter')) return 1;
  const params = field(node, 'parameters');
  if (params?.type === 'implicit_parameter') return 1;
  if (!params) return 0;
  // A Python method's self or cls is how the language passes the object, not an argument a caller gives.
  const receiver = (c, i) => i === 0 && node.type === 'function_definition' && c.type === 'identifier' && (c.text === 'self' || c.text === 'cls');
  const given = params.namedChildren.filter((c, i) => !NOT_A_PARAMETER.has(c.type) && !receiver(c, i));
  const required = given.filter((c) => !OPTIONAL_PARAMETER.has(c.type)).length;
  return required + (required < given.length ? 1 : 0);
}

// A Python docstring is documentation held in a string statement, so it is not a line of code.
const isDocstring = (n) => n.type === 'expression_statement' && n.parent?.type === 'block' && n.namedChildCount === 1 && n.namedChildren[0].type === 'string';

// Lines that hold code: the start row of every token that is not a comment. A nested function's lines are its own, as its complexity
// is, so a test file's describe block is not as long as every test inside it.
function logicalLines(node) {
  const rows = new Set();
  const visit = (n) => {
    if ((n !== node && FUNCTIONS.has(n.type)) || isDocstring(n)) return;
    if (n.childCount === 0) { if (n.type !== 'comment' && n.text.trim() !== '') rows.add(n.startPosition.row); return; }
    for (const c of n.children) visit(c);
  };
  visit(node);
  return rows.size;
}

function hasJsx(node) {
  if (JSX.has(node.type)) return true;
  return node.namedChildren.some((c) => !FUNCTIONS.has(c.type) && hasJsx(c));
}

// What each structure that breaks linear flow adds, and which of its parts sit one nesting level deeper. An else-if adds one and keeps
// the nesting of the if it continues; an else adds one.
function ifStatement(node, nesting, ctx) {
  const elseIf = isElseIf(node);
  ctx.score += elseIf ? 1 : 1 + nesting;
  const base = elseIf ? nesting - 1 : nesting;
  ctx.walk(field(node, 'condition'), base);
  ctx.walk(field(node, 'consequence'), base + 1);
  for (const alternative of node.childrenForFieldName('alternative')) {
    if (alternative.type === 'elif_clause') {
      ctx.score += 1;
      ctx.walk(field(alternative, 'condition'), base);
      ctx.walk(field(alternative, 'consequence'), base + 1);
      continue;
    }
    const inner = alternative.type === 'else_clause' ? alternative.namedChildren.find((c) => c.type !== 'comment') : alternative;
    if (inner && inner.type !== 'if_statement') ctx.score += 1;
    ctx.walk(inner, base + 1);
  }
}

// An except clause has no body field: everything it holds sits one level deeper.
const catches = (node, nesting, ctx) => {
  ctx.score += 1 + nesting;
  for (const c of node.namedChildren) ctx.walk(c, nesting + 1);
};

const nestsIn = (fields) => (node, nesting, ctx) => {
  ctx.score += 1 + nesting;
  const deeper = fields.map((f) => field(node, f));
  for (const c of node.namedChildren) ctx.walk(c, deeper.some((d) => same(c, d)) ? nesting + 1 : nesting);
};

const STRUCTURES = {
  if_statement: ifStatement,
  ternary_expression: nestsIn(['consequence', 'alternative']),
  conditional_expression: nestsIn(['consequence', 'alternative']),
  switch_expression: (node, nesting, ctx) => {
    ctx.score += 1 + nesting;
    for (const c of node.namedChildren) ctx.walk(c, c.type === 'switch_expression_arm' ? nesting + 1 : nesting);
  },
  switch_statement: nestsIn(['body']),
  match_statement: nestsIn(['body']),
  catch_clause: nestsIn(['body']),
  except_clause: catches,
  except_group_clause: catches,
  ...Object.fromEntries([...LOOPS].map((type) => [type, nestsIn(['body'])])),
};

// Increments that do not nest: a jump to a label, a new sequence of like boolean operators, and a call of the function itself.
const labelled = (node) => (field(node, 'label') || node.namedChildren.some((c) => c.type === 'statement_identifier') ? 1 : 0);
const sequence = (node) => {
  const op = operator(node);
  return BOOLEAN.has(op) && !(node.parent?.type === 'binary_expression' && operator(node.parent) === op) ? 1 : 0;
};
const recursion = (node, ctx) => {
  const callee = field(node, 'function');
  return ctx.name && callee?.type === 'identifier' && callee.text === ctx.name ? 1 : 0;
};
// Python spells its boolean operators as words and keeps them in a node type of their own.
const wordSequence = (node) => (node.parent?.type === 'boolean_operator' && operator(node.parent) === operator(node) ? 0 : 1);
const FLAT = { break_statement: labelled, continue_statement: labelled, goto_statement: () => 1, binary_expression: sequence, boolean_operator: wordSequence, call_expression: recursion, invocation_expression: recursion, call: recursion };

// Cognitive complexity of one unit. Nested functions are left out here and scored as their own units by unitsOf.
function cognitive(unit, name, startNesting) {
  const ctx = { score: 0, name };
  ctx.walk = (node, nesting) => {
    if (!node || (node !== unit && FUNCTIONS.has(node.type))) return;
    const structure = STRUCTURES[node.type];
    if (structure) { structure(node, nesting, ctx); return; }
    ctx.score += FLAT[node.type]?.(node, ctx) ?? 0;
    for (const c of node.namedChildren) ctx.walk(c, nesting);
  };
  const body = field(unit, 'body');
  for (const c of body ? [body] : unit.namedChildren) ctx.walk(c, startNesting);
  return ctx.score;
}

function maxDepth(unit) {
  let max = 0;
  const walk = (node, depth) => {
    if (node !== unit && FUNCTIONS.has(node.type)) return;
    const counts = DEPTH.has(node.type) && !isElseIf(node);
    const d = counts ? depth + 1 : depth;
    if (d > max) max = d;
    for (const c of node.namedChildren) walk(c, d);
  };
  walk(unit, 0);
  return max;
}

// The control-flow nesting around a node, counted up to the unit that holds it.
function nestingAt(node) {
  let n = 0;
  for (let p = node.parent, child = node; p && !FUNCTIONS.has(p.type); child = p, p = p.parent) {
    if (LOOPS.has(p.type) || p.type === 'switch_statement' || p.type === 'match_statement' || CATCHES.has(p.type) || TERNARY.has(p.type)) n += 1;
    if (p.type === 'if_statement' && !same(child, field(p, 'condition'))) n += 1;
  }
  return n;
}

/** Every function in the tree with its metrics: name, kind, lines, cognitive, depth and params, oldest-first by position. */
export function unitsOf(tree, { file = '', isTest = false } = {}) {
  const units = [];
  const visit = (node, inherited) => {
    if (FUNCTIONS.has(node.type)) {
      const start = inherited + nestingAt(node);
      const name = nameOf(node);
      const component = /\.(jsx|tsx)$/.test(file) && /^[A-Z]/.test(name ?? '') && hasJsx(node);
      units.push({
        name: name ?? `<anonymous:${node.startPosition.row + 1}>`,
        kind: isTest ? 'test' : component ? 'component' : 'function',
        start: node.startPosition.row + 1,
        end: node.endPosition.row + 1,
        lines: logicalLines(node),
        cognitive: cognitive(node, name, start),
        depth: maxDepth(node),
        // A pytest test names the fixtures it wants as parameters. Nobody passes them, so they are not arguments to count.
        params: isTest && node.type === 'function_definition' ? 0 : paramCount(node),
        // C# overloads, and a constructor beside its destructor, share a name: the gate tells them apart by this.
        signature: `${node.type}(${(field(node, 'parameters') ?? field(node, 'parameter'))?.text.replace(/\s+/g, ' ') ?? ''})`,
      });
      for (const c of node.namedChildren) visit(c, start);
      return;
    }
    for (const c of node.namedChildren) visit(c, inherited);
  };
  visit(tree.rootNode, 0);
  return units;
}

/** Complexity of code outside any function, which counts toward the file's total. */
export function topLevelCognitive(tree) {
  return cognitive(tree.rootNode, null, 0);
}
