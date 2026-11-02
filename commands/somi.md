---
description: "Give SoMi any request or ticket, and it routes the work to the right workflow."
argument-hint: "<what you want, or a ticket>"
---

Call `somi_step` with action `route` and this request, word for word:

$ARGUMENTS

Each answer has a `next` field and a `how` field. Do exactly what `how` says and nothing else until `next` is `done`.
