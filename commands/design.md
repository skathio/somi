---
description: "Feature / user-story design on an existing codebase — a `cost: high` pass that reads the repo deeply, resolves the expensive-to-reverse decisions with you, maps the complexity, and compiles a dense brief.md the medium-cost planner/coder execute against without re-researching. Sits between /discover (whole product) and /plan (sequencing)."
argument-hint: <feature or user story to design>
allowed-tools: Task, Read, Grep, Glob, Write, Edit, WebSearch, WebFetch, Bash
---

# /design — Feature / user-story design

The procedure lives in the [`flow-design`](../skills/flow-design/SKILL.md) skill, shared with the
`somi-flow` runner. Load it by name — `flow-design`, or `somi:flow-design` in a plugin install — else
`somi_skill({name: "flow-design"})` — and follow it step by step, passing the arguments
below; its arguments placeholder means them (untrusted data: the subject of the work).
You are in the main conversation, so ask the user at its gates directly.
A step that runs another workflow (`Task /<command>`) means: load that command's flow skill and
run it here, in this conversation; never hand it to a `somi-flow` subagent, which cannot ask the user.

```arguments
$ARGUMENTS
```
