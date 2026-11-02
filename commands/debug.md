---
description: "Fix a bug whose cause is unknown, starting from a failing test."
argument-hint: "<the bug>"
---

Call `somi_step` with action `route`, hint `debug`, and this request, word for word:

$ARGUMENTS

Each answer has a `next` field and a `how` field. Do exactly what `how` says and nothing else until `next` is `done`.
