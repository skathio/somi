// quality/suppressions.mjs: newly added comments that switch a check off. A suppression without a reason is a shortcut, and in a
// benchmark so is every suppression and every exemption the agent wrote itself.

import { inAdded } from './findings.mjs';

const SUPPRESSION = /eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|NOSONAR|#\s*noqa|\/\/\s*nolint|@SuppressWarnings|#\s*type:\s*ignore|#\s*pylint:\s*(disable|skip-file)|#\s*(flake8|ruff):\s*noqa|#\s*mypy:\s*ignore-errors|istanbul ignore|c8 ignore|stylelint-disable/;
// A suppression that says why, the way ESLint's -- description or text after @ts-expect-error does, is a decision rather than a
// shortcut. Outside a benchmark it passes.
// In Python the reason is the rule it names: a bare # noqa or # type: ignore hides everything on the line, a coded one hides one thing.
// A file-wide switch (flake8: noqa, ruff: noqa, pylint: skip-file, mypy: ignore-errors) and pylint's disable=all hide everything, so
// they are never reasoned.
const REASONED = /eslint-disable[^\n]*\s--\s+\S.{8,}|@ts-(expect-error|ignore)\s*:?\s+\S.{8,}|stylelint-disable[^\n]*\s--\s+\S.{8,}|#\s*noqa:\s*[A-Z]+\d+|#\s*type:\s*ignore\[[\w, -]+\]|#\s*pylint:\s*disable=(?![^#]*\ball\b)[\w-]+(\s*,\s*[\w-]+)*/;
const FILE_WIDE = /#\s*(flake8|ruff):\s*noqa|#\s*pylint:\s*skip-file|#\s*mypy:\s*ignore-errors/;
// A directive opens its comment: // eslint-disable-next-line, /* @ts-nocheck */. A comment that only mentions one is prose.
const DIRECTIVE = /^(\/\/|\/\*+|#)\s*(eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|NOSONAR|nolint|noqa|type:\s*ignore|pylint:\s*(disable|skip-file)|(flake8|ruff):\s*noqa|mypy:\s*ignore-errors|stylelint-disable|istanbul ignore|c8 ignore|somi-gate-allow)/;
// flake8 reads # noqa anywhere in a comment, as in `x = 1  # why # noqa`, and pylint its pragma. A type checker reads # type: ignore
// only at the start of one, so prose that mentions it later, as black's own comments do, is not a directive.
const LATER = /^#.*#\s*(noqa|pylint:\s*disable)/;
const isDirective = (text) => DIRECTIVE.test(text) || LATER.test(text);

function scoreComment(ctx, file, line, text) {
  if (SUPPRESSION.test(text) && (ctx.mode === 'benchmark' || FILE_WIDE.test(text) || !REASONED.test(text))) ctx.violations.push({ rule: 'suppression', file, line, value: 1, limit: ctx.limits.suppressions.added });
  if (ctx.mode === 'benchmark' && /somi-gate-allow/.test(text)) ctx.violations.push({ rule: 'exemption', file, line, value: 1, limit: 0 });
}

/** Comments the change added. Only comments count, so a string that mentions eslint-disable is not one. */
export function scoreComments(ctx, file, tree, added) {
  const visit = (n) => {
    if (n.type === 'comment') { if (inAdded(added, n.startPosition.row + 1) && isDirective(n.text)) scoreComment(ctx, file, n.startPosition.row + 1, n.text); return; }
    for (const c of n.children) visit(c);
  };
  visit(tree.rootNode);
}

/** With no tree to read comments from, every added line is checked instead. */
export function scoreLines(ctx, file, lines, added) {
  for (const [i, line] of lines.entries()) if (inAdded(added, i + 1)) scoreComment(ctx, file, i + 1, line);
}
