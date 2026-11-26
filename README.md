# SoMi

Tell SoMi what you want, in plain words or as a ticket, and it picks the right workflow and keeps the cost down, on Claude Code and GitHub Copilot CLI. You keep talking to your agent the whole time: it can read, answer and change its mind, and SoMi advises instead of taking over.

> **5.2, measured.** On the registered small recording, plain SoMi with `review.security_tier: medium` solved 89 of 96 draws against a bare agent's 73, at 1.36 times bare's cost per solved task ([record](benchmarks/records/registered-small-security-medium-2026-11-18.md)). With the security reviewer on its default, high, it cost 1.85 times. On the smoke recordings against a bare agent on Sonnet ([records](benchmarks/records/deliver-vs-somi5-vs-bare-2026-11-18.md)), plain SoMi met the strict standard (hidden tests pass, its own tests catch broken code, and the quality limits hold) on 35 of 48 small draws against 23, 16 of 30 medium against 9, and 6 of 16 large against 0, at 1.5 to 1.9 times bare's cost per solved task. `/somi-deliver` met it on 26 of 30 medium and 10 of 16 large, at about three times plain SoMi's cost per success, and on small work it did no better than plain SoMi. These are 2–3 draws per task: directions, not significant results.

## How it works

```text
you talk to one agent, on the medium tier, the same as a bare agent
  -> a question, a follow-up, a change of mind: it just answers
  -> a small, clear change: it does it, as a bare agent would
  -> a ticket, large work, or a request that fits no obvious workflow: it asks somi_route once, and gets the
       workflow's steps: each one's tier, whether it runs here or on a subagent, and its brief
  -> large work: it does it too, on medium, and tells you that /somi-deliver runs it in stages
  -> /somi-brief <feature>: it reads the code, asks you only what the code cannot settle, and saves a brief of
       numbered requirements, decisions and scope, with whether /somi-deliver or plain SoMi should build it
  -> /somi-deliver <work or ticket>: a scout, a plan of milestones, and for each one rule tests, a build that
       steps up a tier if the checks fail, and the checks; the reviews the diff needs, each on its tier, run in
       code through to the end; a line still unmet gets one build a tier up, and a Blocker or Major the last review
       finds gets one round of fixes; a blocked or unfinished milestone stops it and comes back to you
  -> the diff touches a security sink: the security reviewer runs on high, and every fix stays here, on medium
  -> work that needs more, such as design: it goes up to a worker on the high tier
  -> a turn that changed code ends: the quality gate runs, anything over a limit goes back to be fixed,
       and the diff decides if a review is due
  -> somi_pr: refuses clean text for a change that needed a review and has none, or that fails the quality gate
```

SoMi keeps no workflow state, so nothing can be "still open" and nothing refuses your next request. A bare agent runs everything on medium. SoMi runs the conversation there too, and code is written on medium: on the low tier it broke rules and fell below the quality bar, and the fixes cost more than the low tier saved. The low tier does what needs no judgement, such as finding the files and running the checks. The deterministic parts are done by SoMi's tools, not left to the model: which reviewers a diff needs, the briefs workers and reviewers get, the plan file and the pull request text.

| | 4.1 | 5.0 |
|---|---|---|
| Who is in charge | A workflow's procedure | Your agent, with SoMi advising and building the deterministic parts |
| When a review runs | Sized before coding | Decided from signals in the real diff when a turn ends, with one reviewer, and checked before the pull request text |
| Long work | Plan and progress files read by hand | One plan file, a small ledger put back after every compaction, and each milestone routed on its own |
| Model tiers | A lookup the agent could skip | The conversation on medium, workers and reviewers set by a hook |
| Listed entries | 91 | 15: 7 commands, 6 agents, one skill and one workflow, with a library behind them |
| Other plugins | No way in | Shards, connected from `/somi-config` |

## Install

On Claude Code:

```text
/plugin marketplace add https://github.com/skathio/somi
/plugin install somi@somi
```

On GitHub Copilot CLI:

```bash
copilot plugin marketplace add https://github.com/skathio/somi
copilot plugin install somi@somi
```

## Use

Start with SoMi as the session's agent and just talk to it:

```bash
claude --agent somi:somi    # or: copilot --agent somi:somi
```

`somi launch claude` or `somi launch copilot` starts the host that way, on the model your config sets for the conversation's tier. Ask `/somi-config` for the full command, and wrap it in an alias of your own.

Ask for a change, a bug fix, a refactor, a plan, a design, a review, an upgrade or the pull request text in plain words, or paste a ticket, and SoMi's agent picks the workflow. Seven commands do the rest: `/somi`, `/somi-brief`, `/somi-deliver`, `/somi-review`, `/somi-quality`, `/somi-status` and `/somi-config`. [Getting started](https://skathio.github.io/somi/docs/) ([source](docs/getting-started.md)) walks through a first session, and [Commands](https://skathio.github.io/somi/docs/commands.html) ([source](docs/commands.md)) says what each command takes.

## Set your tiers

Choose the models for each tier, and the security reviewer's tier, as [Configuration](https://skathio.github.io/somi/docs/configuration.html#tiers) ([source](docs/configuration.md#tiers)) shows, and see [Hosts](https://skathio.github.io/somi/docs/hosts.html) ([source](docs/hosts.md)) for Auto, plans and VS Code on Copilot.

## Set your quality limits

The quality gate's limits, its level, its commit, pull request and repository scopes, import rules and time limit are in [Configuration](https://skathio.github.io/somi/docs/configuration.html#quality-limits) ([source](docs/configuration.md#quality-limits)).

## Connect other plugins with shards

To slot another plugin's skill, agent or tool into one of SoMi's steps, see [Shards](https://skathio.github.io/somi/docs/shards.html) ([source](docs/shards.md)).

## Turn on the sandbox

Hooks are tripwires, not a security boundary: turn on the sandbox and check it with `somi doctor`, as [Sandbox and trust](https://skathio.github.io/somi/docs/sandbox.html) ([source](docs/sandbox.md)) shows.

## Upgrading from 4.1

This is a breaking release. See [the migration guide](docs/MIGRATING-TO-5.md). Remove a 4.x install first: if both load, both sets of hooks and skills run. On Copilot, `copilot plugin list` shows which version is installed, and a project that ran an earlier `somi init` should delete `.github/hooks/somi.json`, or every hook runs twice.

## Docs

- [User guides on the docs site](https://skathio.github.io/somi/docs/): getting started, workflows, commands, configuration, hosts, shards, and sandbox and trust
- [Architecture and trust model](docs/ARCHITECTURE.md)
- [Benchmark and release decision](docs/BENCHMARK.md)
- [Migrating from 4.x](docs/MIGRATING-TO-5.md)
- [Versioning](docs/VERSIONING.md)
- [Changelog](CHANGELOG.md)

MIT licensed.
