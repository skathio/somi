# SoMi

Tell SoMi what you want, in plain words or as a ticket, and it picks the right workflow and keeps the cost down, on Claude Code and GitHub Copilot CLI. You keep talking to your agent the whole time: it can read, answer and change its mind, and SoMi advises instead of taking over.

> **Status: 5.0 release candidate.** This design replaces an earlier step engine that proved too restrictive in real use. It has not been through the [benchmark](docs/BENCHMARK.md) yet, and those results describe the earlier design.

## How it works

```text
you talk to one agent, on the medium tier, the same as a bare agent
  -> a question, a follow-up, a change of mind: it just answers
  -> work to do: it asks somi_route once, and gets the workflow's steps: each one's tier, whether it runs here or on a subagent, and its brief
  -> a small change: it does it, as a bare agent would
  -> large work: it does it too, on medium, and tells you that /somi:deliver runs it in stages
  -> /somi:deliver <work or ticket>: a scout, a build that steps up a tier if the checks fail, the checks, and
       the reviews the diff needs, each on its tier, run in code through to the end
  -> the diff touches a security sink: the review and every fix stay here, on medium
  -> work that needs more, such as design: it goes up to a worker on the high tier
  -> the change is ready: somi_review reads the diff and says if a review is due
  -> somi_pr: refuses clean text for a change that needed a review and has none
```

SoMi keeps no workflow state, so nothing can be "still open" and nothing refuses your next request. A bare agent runs everything on medium. SoMi runs the conversation there too, and code is written on medium: on the low tier it broke rules and fell below the quality bar, and the fixes cost more than the low tier saved. The low tier does what needs no judgement, such as finding the files and running the checks. The deterministic parts are done by SoMi's tools, not left to the model: which reviewers a diff needs, the briefs workers and reviewers get, the plan file and the pull request text.

| | 4.1 | 5.0 |
|---|---|---|
| Who is in charge | A workflow's procedure | Your agent, with SoMi advising and building the deterministic parts |
| When a review runs | Sized before coding | Decided from signals in the real diff, and checked at `somi pr` |
| Long work | Plan and progress files read by hand | One plan file, a small ledger put back after every compaction, and fresh context per milestone |
| Model tiers | A lookup the agent could skip | The conversation on medium, workers and reviewers set by a hook |
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

Start with SoMi as the session's agent and just talk to it:

```bash
claude --agent somi:somi    # or: copilot --agent somi:somi
```

It runs on your session's model. To run the conversation on a different tier's model instead, set `tiers.main` and run `somi setup`, which writes `somi-main` to your own agent folder. Outside SoMi's agent, plain prompts are not routed, and SoMi says so at session start.

| Command | What it does |
|---|---|
| `/somi <anything>` | Asks which workflow fits. This is the default. |
| `/code`, `/debug`, `/refactor` | Build a change, fix a bug from a failing test, or change structure under green tests. |
| `/plan`, `/design` | Split large work into milestones, or settle an expensive choice. |
| `/review`, `/security-review` | Judge changes, with a stronger model on security. |
| `/upgrade`, `/incident`, `/a11y-check` | Move a dependency, restore production, or build interface against a checklist. |
| `/somi:deliver` | Run large work as SoMi's staged workflow. Only you can start it. On Copilot it needs `somi init --host copilot` and experimental mode. |
| `/ship`, `/status`, `/somi-config` | Full suite and PR text, open plan and findings, and which model each tier uses. |

Older command names still work.

## Set your tiers

You choose the models for each environment in `~/.config/somi/config.json`. `main` is the tier your conversation runs on, medium by default. Code is written on medium, in the conversation or in `/somi:deliver`'s build, and work above the conversation's tier goes up to a worker. The low tier only gathers information and runs checks. When the diff shows security signals, the review and any fix stay on `main`:

```json
{ "tiers": { "main": "medium", "claude": { "low": "haiku", "medium": "sonnet", "high": "opus" }, "copilot": { "low": "<model>", "medium": "<model>", "high": "<model>" }, "ceiling": "high" } }
```

Claude Code has those defaults. Copilot has none, because its models vary by plan, so a tier with no model runs on the session's. Three things to know on Copilot CLI:

- **Auto:** with the session model on Auto, every subagent gets the model Auto chose, so tiers do nothing. Pick a named model for the session, and `somi doctor` warns about Auto.
- **A model your plan cannot use:** it falls back to the session's model without an error.
- **VS Code:** it refuses a subagent above the main model's cost tier, so there the main agent needs to run on the strongest tier you want to use.

## Set your quality limits

`somi quality` checks what a change touched against limits on complexity, nesting, length, parameters, copied code and suppressions. The defaults are in [ARCHITECTURE.md](docs/ARCHITECTURE.md#quality-gate). It runs at two scopes. `somi quality --scope commit` scores what a commit adds to the last one. The default, `--scope pr`, scores the whole branch since it left the main branch, which is what goes into a pull request. Both scopes share every limit except how much one change may add to a file: 25 in a commit and 100 in a pull request.

Set your own under `quality` in the same global file, and give either scope its own values under `quality.commit` or `quality.pr`:

```json
{ "quality": { "function": { "cognitive": 15, "depth": 4, "lines": 60, "params": 4 }, "commit": { "file": { "added_cognitive": 25 } }, "pr": { "file": { "added_cognitive": 100 } } } }
```

A project's `.somi/config.json` can only make a limit stricter: a looser value there is ignored, and `somi quality` says so. SoMi asks before an agent changes a limit.

`somi check` runs the gate on every commit, and `somi check --full` before a push at branch scope. `somi pr` writes no pull request text while the branch fails it. `/somi:deliver` checks each build at branch scope and steps the build up a tier with the findings.

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
