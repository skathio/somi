// quality/css.mjs: stylesheet rules the gate checks. All of them are convention, not measured outcomes: nesting depth, how many
// compound selectors a selector chains, ID selectors (which win every specificity fight) and !important.

const COMBINATORS = new Set(['descendant_selector', 'child_selector', 'sibling_selector', 'adjacent_sibling_selector']);

function compound(selector) {
  let n = 1;
  const visit = (s) => { if (COMBINATORS.has(s.type)) n += 1; for (const c of s.namedChildren) visit(c); };
  visit(selector);
  return n;
}

function count(node, type) {
  let n = node.type === type ? 1 : 0;
  for (const c of node.namedChildren) n += count(c, type);
  return n;
}

/** [{ line, nesting, compound, ids, important }] for every rule set, with its first line. */
export function cssRules(tree) {
  const out = [];
  const visit = (node, depth) => {
    if (node.type === 'rule_set') {
      const selectors = node.namedChildren.find((c) => c.type === 'selectors');
      const list = selectors ? selectors.namedChildren : [];
      const block = node.namedChildren.find((c) => c.type === 'block');
      const own = block ? block.namedChildren.filter((c) => c.type !== 'rule_set') : [];
      out.push({
        line: node.startPosition.row + 1,
        end: node.endPosition.row + 1,
        nesting: depth + 1,
        compound: Math.max(0, ...list.map(compound)),
        ids: list.reduce((s, sel) => s + count(sel, 'id_selector'), 0),
        important: own.reduce((s, d) => s + count(d, 'important'), 0),
      });
      if (block) for (const c of block.namedChildren) visit(c, depth + 1);
      return;
    }
    for (const c of node.namedChildren) visit(c, depth);
  };
  visit(tree.rootNode, 0);
  return out;
}
