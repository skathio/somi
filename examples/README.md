# Examples

Worked examples of the SOMI workflows in action, plus a minimal consuming project showing the
project-local install layout.

## Worked examples

- [`feature-plan-example.md`](./feature-plan-example.md) — what a planner output for a real feature looks like.
- [`code-review-example.md`](./code-review-example.md) — a severity-graded review of a small diff.
- [`full-pipeline-example.md`](./full-pipeline-example.md) — `/ship` end-to-end on a tiny feature.

## Minimal consuming project

- [`sample-consumer/`](./sample-consumer/) — a directory that shows the layout after running
  `install.sh --scope project` against a project. Use it as a reference for what your repo should look
  like post-install.

The sample doesn't ship actual application code — it's just the `.claude/` shape and a stub `CLAUDE.md`
that demonstrates the project's own conventions sitting on top of the SOMI ones.
