# Hosts

SoMi runs on Claude Code and GitHub Copilot CLI from the same plugin. Most of it works the same on both, including the hooks: Copilot CLI runs Claude-format plugin hooks, the end-of-turn quality gate included. This page covers what differs.

| | Claude Code | Copilot CLI |
|---|---|---|
| Command names | `/somi-review` or `/somi:somi-review` | `/somi-review` only |
| `/somi-deliver` | From the plugin's `workflows/` folder | Registered at session start, and needs `/experimental` |
| Default tier models | `haiku`, `sonnet` and `opus` | None: set them yourself |
| Sandbox | `/sandbox`, with the profile in `profiles/claude.json` | `/sandbox enable`, in public preview |

## Command names

On Claude Code, SoMi's commands answer to their plain names, such as `/somi-review`, and also to their namespaced ones, such as `/somi:somi-review`. On Copilot CLI, SoMi's commands are listed as skills, by their plain names only: type `/somi-deliver`, not `/somi:somi-deliver`.

## /somi-deliver and /experimental on Copilot

Copilot CLI loads workflows only from an extension, and it runs them only in experimental mode. At session start, SoMi writes its extension to `$COPILOT_HOME/extensions/somi/extension.mjs` (`~/.copilot` by default) once for every project, so there is nothing to run for it. Then:

- **Experimental mode:** turn it on with `/experimental`, or start with `copilot --experimental`. `somi launch copilot` adds `--experimental` for you.
- **A session already open:** it gets `/somi-deliver` after `/clear` or in a new session.
- **To turn it off:** `"copilot": { "workflows": false }` in your global config. SoMi never overwrites an `extension.mjs` it did not write. `somi init --host copilot` registers it again by hand.

## Tier models on Copilot

Claude Code has default models for each tier. Copilot has none, because its models vary by plan, so a tier with no model runs on the session's model. Set them under `tiers.copilot` in your global config, as [Configuration](configuration.md#tiers) shows. Three things to know on Copilot CLI:

- **Auto:** with the session model on Auto, every subagent gets the model Auto chose, so tiers do nothing. Pick a named model for the session. `somi doctor`, which `/somi-config`'s setup check runs, warns about Auto.
- **A model your plan cannot use:** Copilot falls back to the session's model without an error.
- **VS Code:** it refuses a subagent above the main model's cost tier, and the subagent does not run, so there the main agent needs to run on the strongest tier you want to use.

Only billing proves a tier. On a Copilot account using automatic model selection, a live run showed a worker naming its configured model while its model calls went to the one Auto chose.

## Hooks that run twice on Copilot

An earlier `somi init` wrote SoMi's hooks into the project as `.github/hooks/somi.json`. Copilot CLI now runs the plugin's own hooks, so with that file every SoMi hook runs twice. Delete `.github/hooks/somi.json`. `somi doctor` warns when it finds the file.

## SoMi's agent on each host

Start either host with `--agent somi:somi`, as [Getting started](getting-started.md#start-a-session-with-somis-agent) shows. In a Copilot session already running, `/agent somi` switches to it. Outside SoMi's agent, plain prompts are not routed, and on Copilot SoMi says so at session start. In VS Code and the cloud agent, SoMi's instructions apply, and its command line runs in a terminal.
