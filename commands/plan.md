---
description: "Split large work into milestones that each get fresh context."
argument-hint: "<the goal>"
---

Call `somi_step` with action `route`, hint `plan`, and this request, word for word:

$ARGUMENTS

Each answer has a `next` field and a `how` field. Do exactly what `how` says and nothing else until `next` is `done`.
