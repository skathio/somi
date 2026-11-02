---
description: "Upgrade a dependency from its real changelog and migrate its uses."
argument-hint: "<the dependency>"
---

Call `somi_step` with action `route`, hint `upgrade`, and this request, word for word:

$ARGUMENTS

Each answer has a `next` field and a `how` field. Do exactly what `how` says and nothing else until `next` is `done`.
