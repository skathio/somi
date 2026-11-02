---
description: "Opt-in: split work too big for one sitting into feature-sized milestones, each with a test or command that proves it."
argument-hint: "<the goal>"
---

Use this only when the maintainer asks for a plan for `$ARGUMENTS`. Most work goes straight to `/task`.

Write one plan and pipe it to `somi plan`, which saves it. `somi` means the CLI named in your session context, or `npx @skathio/somi`. For each milestone give one line on what it delivers and one executable acceptance test or command that can fail. Size a milestone as one feature built and tested together. Do not write briefs, specs, phase files or a line budget.

Put each expensive-to-reverse choice to the maintainer as options with the cost of reversing it, then stop. When the plan is approved, run each milestone with `/task`.
