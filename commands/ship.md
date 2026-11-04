---
description: "Run the full suite, then write the pull request text from the journal."
argument-hint: "[notes]"
---

Call `somi_step` with action `route`, hint `ship`, and this request, word for word:

$ARGUMENTS

Each answer has a `next` field and a `how` field. Do exactly what `how` says and nothing else until `next` is `done`.
