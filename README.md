# SoMi

Tell SoMi what you want, in plain words or as a ticket, and it runs the right workflow for you on Claude Code and GitHub Copilot CLI. It routes the work, hands it to workers on the cheapest model that can do it, and adds process only when the real work calls for it.

> **Status: 5.0 release candidate.** 5.0 ships as the default only if the [pre-registered benchmark](docs/BENCHMARK.md) says so. The 4.x line stays on the `4.x` branch.

## How it works

```text
your request or ticket
  -> a thin coordinator asks the step engine what the work is
  -> small and clear: one low-tier worker builds it, checks it and commits it
  -> the diff calls for it: a fresh reviewer, and a security reviewer on a trust boundary
  -> too big for one sitting: a plan you approve, then a fresh worker per milestone
  -> failing twice: a clean restart one tier up, with the working tree and not the old transcript
```

The procedure lives in the step engine, so the coordinator stays small and only about 15 entries are ever listed. The library behind it can grow without costing anything on work that does not use it.

| | 4.1 | 5.0 |
|---|---|---|
| Where a workflow's procedure lives | In the coordinator's context | In the step engine, returned one step at a time |
| When a review runs | Sized before coding | After coding, from signals in the real diff |
| Long work | Plan and progress files read by hand | A small ledger put back after every compaction, and fresh context per milestone |
| Model tiers | A lookup the agent could skip | Applied by a hook, and proven from billing |
| Listed entries | 91 | 15, with a hidden library behind them |
| Other plugins | No way in | Shards: `somi slot pr.open <plugin>` |

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

Give a request to `/somi`, or make the coordinator your active agent and just talk to it:

```bash
claude --agent somi:somi      # or set "agent": "somi:somi" in a project's .claude/settings.json
copilot --agent somi:somi
```

Outside the active agent, plain prompts are not routed, and SoMi says so at session start. Direct commands such as `/debug` or `/review` skip the routing question.

| Command | What it does |
|---|---|
| `/somi <anything>` | Routes it. This is the default. |
| `/code`, `/debug`, `/refactor` | Build a change, fix a bug from a failing test, or change structure under green tests. |
| `/plan`, `/design` | Split large work into milestones, or settle an expensive choice. |
| `/review`, `/security-review` | Judge changes, with a stronger model on security. |
| `/upgrade`, `/incident`, `/a11y-check` | Move a dependency, restore production, or build interface against a checklist. |
| `/ship`, `/status`, `/somi-config` | Full suite and PR text, open work, and which model each tier uses. |

Older command names still work and route to the same workflows.

## Set your tiers

Workers run on low, medium and high tiers. You choose the models for each environment in `~/.config/somi/config.json` or a project's `.somi/config.json`:

```json
{ "tiers": { "claude": { "low": "haiku", "medium": "sonnet", "high": "opus" }, "copilot": { "low": "<model>", "medium": "<model>", "high": "<model>" }, "ceiling": "high" } }
```

Claude Code has those defaults. Copilot has none, because its models vary by plan: a tier with no model inherits the session's, and SoMi says it is not enforced. On a Copilot account using automatic model selection, a worker's model may be reported but not billed, so check your billing.

## Connect other plugins with shards

A shard slots another plugin's skill, agent or tool into a named step: `work-item.start`, `plan.approved`, `pr.open` or `review.done`.

```bash
somi slot work-item.start jira:fetch-ticket
somi slot pr.open github:open-pr --mode write
somi slot --list
```

A shard keeps working when its plugin updates, and tells you it changed. What it returns is treated as data, never as instructions. Anything that writes outward asks first, and a changed write shard stays held until you confirm.

## Turn on the sandbox

Hooks catch honest mistakes. They are not a security boundary. Print the recommended settings, merge them into your host's settings, then run the doctor from inside an agent session:

```bash
somi doctor --profile
somi doctor
```

`doctor` passes only when writing to your home directory and reaching the network directly both fail inside the agent's shell. See [the trust model](docs/ARCHITECTURE.md#trust-model).

## Upgrading from 4.1

This is a breaking release. See [the migration guide](docs/MIGRATING-TO-5.md).

## Docs

- [Architecture and trust model](docs/ARCHITECTURE.md)
- [Benchmark and release decision](docs/BENCHMARK.md)
- [Migrating from 4.x](docs/MIGRATING-TO-5.md)
- [Versioning](docs/VERSIONING.md)
- [Changelog](CHANGELOG.md)

MIT licensed.
