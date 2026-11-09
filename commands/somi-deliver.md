---
description: "Run a piece of work as SoMi's staged workflow: scout, build, verify and review, each on its cost tier, through to the end."
argument-hint: "<the work, or a ticket>"
disable-model-invocation: true
---

The user typed this command to run this work as SoMi's staged workflow. Call `somi_route` with `staged` true and `request` set to this, plus anything from the conversation it depends on:

$ARGUMENTS

Then follow what it returns. When it gives you a workflow, start it as it says: that is what the user asked for here.
