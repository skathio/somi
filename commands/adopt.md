---
description: One-time SoMi onboarding for an existing codebase. Builds the Repo Atlas, confirms detected conventions into a pre-filled 99-overrides scaffold, produces a gap report (test thin ice, hotspots, candidate first refactors), and suggests a calibration work item.
argument-hint: (no arguments — run once after installing SoMi in a repo)
allowed-tools: Task, Read, Grep, Glob, Bash, Write, Edit
---

# /adopt — Onboard SoMi into an existing codebase

The procedure lives in the [`flow-adopt`](../skills/flow-adopt/SKILL.md) skill, shared with the
`somi-flow` runner. Load it by name — `flow-adopt`, or `somi:flow-adopt` in a plugin install — else
`somi_skill({name: "flow-adopt"})` — and follow it step by step.
You are in the main conversation, so ask the user at its gates directly.
A step that runs another workflow (`Task /<command>`) means: load that command's flow skill and
run it here, in this conversation; never hand it to a `somi-flow` subagent, which cannot ask the user.
