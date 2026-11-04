---
description: "Build one clear change, with a review only if the diff calls for it."
argument-hint: "<the change>"
---

Call `somi_step` with action `route`, hint `build`, and this request, word for word:

$ARGUMENTS

Each answer has a `next` field and a `how` field. Do exactly what `how` says and nothing else until `next` is `done`.
