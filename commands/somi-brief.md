---
description: "Prepare a new feature or an improvement as a brief ready to hand off: SoMi reads the code, asks what it cannot settle, and saves the brief for /somi-deliver or plain SoMi."
argument-hint: "<the feature or improvement>"
disable-model-invocation: true
---

The user typed this command to prepare work as a brief before anyone builds it. Call `somi_route` with hint `brief` and `request` set to this, plus anything from the conversation it depends on:

$ARGUMENTS

Then follow what it returns. Build nothing: the result is the brief, saved once the user approves it.
