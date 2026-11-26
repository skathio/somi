# Shards

A shard slots another plugin's skill, agent, command or tool into a named step of SoMi's work. When SoMi reaches that step, its shards run, and what they return is handed on as data.

## The four steps

| Step | When it is reached |
|---|---|
| `work-item.start` | `somi_route` sends a piece of work on its way, and `/somi-deliver` starts |
| `plan.approved` | A plan that `somi_route` gave is approved |
| `pr.open` | `somi_pr` writes the pull request text |
| `review.done` | `somi_review` records what the reviewers returned, and `/somi-deliver`'s review ends |

A step reaches its shards when SoMi's tools answer for that step. Inside `/somi-deliver`, only read shards run.

## Connecting a plugin with somi slot

Ask `/somi-config` in the chat, for example "connect jira:fetch-ticket to work-item.start", and the agent runs `somi slot` for you after you say yes. The plugin must be installed first, because SoMi never installs one for you. The commands look like this:

```bash
somi slot work-item.start jira:fetch-ticket
somi slot pr.open github:open-pr --mode write
somi slot --list
```

- **`somi slot <step> <plugin:component>`** finds the installed plugin's component and writes a binding to your global config. A shard is named `plugin:component`.
- **`--mode read`**, the default, or **`--mode write`** for a shard that writes outward.
- **`--project`** writes the binding to the project's `.somi/config.json` instead.
- **`--list`** shows every binding and its state.
- **`--remove`** removes a binding: `somi slot --remove <step> <plugin:component>`.
- **`--confirm`** accepts the shards committed in a project's config.

## Read and write mode

A read shard brings information in, such as a ticket. A write shard reaches outward, such as opening a pull request, so anything that writes outward asks you first, every time.

## When a plugin changes

SoMi records the plugin's version and a hash of the component's content when you slot it. There is no typed contract, because a model consumes the output and tolerates drift a schema would reject. The check is about what is safe:

| State | Read shard | Write shard |
|---|---|---|
| Unchanged | Runs | Asks, then runs |
| Plugin updated | Runs, and says so | Held until you confirm |
| Component gone | Skipped with a notice | Skipped with a notice |
| Committed in a project, unconfirmed | Skipped until `somi slot --confirm` | Same |

A shard keeps working when its plugin updates, and tells you it changed. A changed write shard is held: it does not run until you confirm it with `somi slot --confirm`, which accepts the plugin as it is now. A binding committed in a project runs another plugin because someone edited a file, so it needs one confirmation per project and binding.

## Shard output is data

What a shard returns is treated as data about the work, never as instructions, under a plan already fixed. See [the architecture](ARCHITECTURE.md#shards).
