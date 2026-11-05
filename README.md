# SoMi

Tell SoMi what you want, in plain words or as a ticket, and it picks the right workflow and keeps the cost down, on Claude Code and GitHub Copilot CLI. You keep talking to your agent the whole time: it can read, answer and change its mind, and SoMi advises instead of taking over.

> **Status: 5.0 release candidate.** This design replaces an earlier step engine that proved too restrictive in real use. It has not been through the [benchmark](docs/BENCHMARK.md) yet, and those results describe the earlier design.

## How it works

```text
you talk to one agent, on the model you chose for it
  -> a question, a follow-up, a change of mind: it just answers
  -> work to do: it asks somi_route once, and gets the workflow, the tier and what to do
  -> within its tier: it does the work here, where the context already is
  -> needs a stronger model: it writes a brief with what the conversation decided, and hands that one piece to a worker
  -> the change is ready: somi_review reads the diff and says if a review is due
  -> `somi pr`: refuses clean text for a change that needed a review and has none
```

SoMi keeps no workflow state, so nothing can be "still open" and nothing refuses your next request. Most of the saving comes from the model the conversation runs on, because the main thread re-sends everything on every turn. Handing small work to a worker costs more than it saves, so SoMi only delegates what needs a stronger model.

| | 4.1 | 5.0 |
|---|---|---|
| Who is in charge | A workflow's procedure | Your agent, with SoMi advising |
| When a review runs | Sized before coding | Decided from signals in the real diff, and checked at `somi pr` |
| Long work | Plan and progress files read by hand | One plan file, a small ledger put back after every compaction, and fresh context per milestone |
| Model tiers | A lookup the agent could skip | The session agent's model, and a hook for workers and reviewers |
| Listed entries | 91 | 15, with a library behind them |
| Other plugins | No way in | Shards: `somi slot pr.open <plugin:component>` |

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

Set your models, then start with SoMi as the session's agent:

```bash
somi setup                    # writes the agent to your own agent folder, on the model for its tier
copilot --agent somi-main     # or: claude --agent somi-main
```

Then just talk to it. On Claude Code, passing `--model` as well overrides the agent's model. Without `somi setup`, use `--agent somi:somi`, which runs on your session's model, or give a request to `/somi`. Outside SoMi's agent, plain prompts are not routed, and SoMi says so at session start.

| Command | What it does |
|---|---|
| `/somi <anything>` | Asks which workflow fits. This is the default. |
| `/code`, `/debug`, `/refactor` | Build a change, fix a bug from a failing test, or change structure under green tests. |
| `/plan`, `/design` | Split large work into milestones, or settle an expensive choice. |
| `/review`, `/security-review` | Judge changes, with a stronger model on security. |
| `/upgrade`, `/incident`, `/a11y-check` | Move a dependency, restore production, or build interface against a checklist. |
| `/ship`, `/status`, `/somi-config` | Full suite and PR text, open plan and findings, and which model each tier uses. |

Older command names still work.

## Set your tiers

You choose the models for each environment in `~/.config/somi/config.json`. `main` is the tier your conversation runs on, and work above it goes to a worker:

```json
{ "tiers": { "main": "low", "claude": { "low": "haiku", "medium": "sonnet", "high": "opus" }, "copilot": { "low": "<model>", "medium": "<model>", "high": "<model>" }, "ceiling": "high" } }
```

Claude Code has those defaults. Copilot has none, because its models vary by plan, so a tier with no model runs on the session's. Three things to know on Copilot CLI:

- **Auto:** with the session model on Auto, every subagent gets the model Auto chose, so tiers do nothing. `somi setup` avoids this, and `somi doctor` warns about it.
- **A model your plan cannot use:** it falls back to the session's model without an error.
- **VS Code:** it refuses a subagent above the main model's cost tier, so there the main agent needs to run on the strongest tier you want to use.

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

This is a breaking release. See [the migration guide](docs/MIGRATING-TO-5.md). Remove a 4.x install first: if both load, both sets of hooks and skills run.

## Docs

- [Architecture and trust model](docs/ARCHITECTURE.md)
- [Benchmark and release decision](docs/BENCHMARK.md)
- [Migrating from 4.x](docs/MIGRATING-TO-5.md)
- [Versioning](docs/VERSIONING.md)
- [Changelog](CHANGELOG.md)

MIT licensed.
