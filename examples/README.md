# Examples

Worked examples of the SoMi workflows in action, plus a minimal consuming project showing the
project-local install layout.

## Worked examples

- [`discovery-example.md`](./discovery-example.md) — a `/discover` run for a new product: cited research → traceable requirements → high-level design, with a verified crossroads.
- [`feature-plan-example.md`](./feature-plan-example.md) — what a planner output for a real feature looks like.
- [`code-review-example.md`](./code-review-example.md) — a severity-graded review of a small diff.
- [`full-pipeline-example.md`](./full-pipeline-example.md) — `/ship` end-to-end on a tiny feature.

## Minimal consuming project

- [`sample-consumer/`](./sample-consumer/) — a reference layout showing how a project looks after
  installing SoMi via `/plugin install somi@somi`. The `.claude/` shape and `CLAUDE.md` here
  demonstrate project-specific conventions sitting on top of the SoMi ones.

The sample doesn't ship actual application code — it's a layout reference only.
