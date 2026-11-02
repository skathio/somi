---
description: "Restore a broken production service first, then record the follow-up."
argument-hint: "<what is broken>"
---

Call `somi_step` with action `route`, hint `incident`, and this request, word for word:

$ARGUMENTS

Each answer has a `next` field and a `how` field. Do exactly what `how` says and nothing else until `next` is `done`.
