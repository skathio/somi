---
description: "Check code against SoMi's quality limits: this branch by default, or the whole codebase."
argument-hint: "[commit | repo]"
---

Call `somi_quality` with `scope` set to `commit` or `repo` if this names one, and leave it out otherwise to check the whole branch:

$ARGUMENTS

Then tell the user what it found, worst first, in a few lines. If they ask for fixes, refactor the code you or they changed until it passes, with the tests still green, and never add a somi-gate-allow exemption to get past it.
