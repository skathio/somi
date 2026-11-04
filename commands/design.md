---
description: "Settle an expensive-to-reverse choice, with options and reversal costs."
argument-hint: "<the choice>"
---

Call `somi_step` with action `route`, hint `design`, and this request, word for word:

$ARGUMENTS

Each answer has a `next` field and a `how` field. Do exactly what `how` says and nothing else until `next` is `done`.
