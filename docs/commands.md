# Commands

SoMi has seven commands. You rarely need them: plain words to SoMi's agent are routed the same way. Each command is a file in the plugin's `commands/` folder, and most of them hand what you typed to `somi_route` with a hint, then follow what it returns. You stay in the conversation, and the agent can read, ask and answer throughout.

On Claude Code each one also answers to its namespaced name, such as `/somi:somi-review`. On Copilot CLI, type the plain name only: `/somi-deliver`, not the namespaced one. See [Hosts](hosts.md#command-names).

| Command | Arguments | What it does |
|---|---|---|
| `/somi` | What you want, a ticket, or a command such as `doctor` | Routes anything, the way the agent does with plain words, or runs one of SoMi's own commands |
| `/somi-brief` | The feature or improvement | Prepares a brief ready to hand off, and builds nothing |
| `/somi-deliver` | The work, or a ticket; nothing to build the open brief | Runs the work as SoMi's staged workflow. Only you can start it |
| `/somi-review` | Optional: a diff or a pull request | Reviews the current changes or a named diff once |
| `/somi-quality` | Optional: `commit` or `repo` | Checks code against the quality limits: the branch by default |
| `/somi-status` | None | Shows open work, findings and decisions |
| `/somi-config` | None | Shows and changes the models each tier uses and the quality limits, and checks the setup |

## /somi

`/somi <anything>` routes a request or a ticket, the way SoMi's agent does with plain words. Use it from another agent, where plain prompts are not routed.

`/somi <command>` runs SoMi's own command line from the chat, so you never need the terminal. Only text that is one of the commands below and its own options counts as one: "check the login page" is a request and is routed as one. Every value must be a plain word. A command that changes your setup or SoMi's state runs only after you say yes.

| Command | Options | What it does |
|---|---|---|
| `/somi doctor` | `--host claude` or `--host copilot`, `--profile` | Checks SoMi's setup: the hooks, the sandbox, the tier models and the host. `--profile` prints the recommended sandbox settings. See [Sandbox and trust](sandbox.md) |
| `/somi check` | `--full` | Runs the quality gate and the project's tests on this change. `--full` checks the whole branch and runs the full suite |
| `/somi status` | None | Shows the open plan, decisions and findings |
| `/somi quality` | `--scope commit`, `--scope pr` or `--scope repo` | Scores code against the quality limits: the branch, one commit, or the whole codebase. The agent calls `somi_quality` for it |
| `/somi review` | `--security` | Reviews the current changes, whether or not the diff calls for it. `--security` asks for the security reviewer, which then always runs on high. The agent calls `somi_review` for it |
| `/somi pr` | None | Writes the pull request text, refused while a needed review is missing or the branch fails the quality gate. The agent calls `somi_pr` for it |
| `/somi config` | None | Shows and changes the models each tier uses and the quality limits |
| `/somi slot` | A step and a `plugin:component`; `--mode read` or `--mode write`, `--project`, `--list`, `--remove`, `--confirm` | Connects another plugin to a step, or lists what is connected. Asks first, except for `--list`. See [Shards](shards.md) |
| `/somi setup` | `--host claude` or `--host copilot` | Makes SoMi the session agent, on the model set for its tier, by writing SoMi's agent file into your own agent folder. Asks first |
| `/somi init` | `--host copilot` | Registers the staged workflow with Copilot CLI for every project, by adding SoMi's extension to your Copilot CLI home. Asks first |
| `/somi migrate` | None | Copies open findings and decisions from SoMi 4.x records into SoMi's current state, once. Asks first |
| `/somi launch` | `claude` or `copilot` | Starts a new host session with SoMi's agent on its tier's model. It does not run inside the current session: the agent gives you the command to run in a terminal. See [Getting started](getting-started.md#start-on-your-tiers-model-with-somi-launch) |
| `/somi help` | None | Lists these commands |

## /somi-brief

`/somi-brief <the feature or improvement>` prepares work as a brief before anyone builds it. It calls `somi_route` with the hint `brief`. The agent reads the code, asks you what it cannot settle, and saves the brief once you approve it. The brief recommends `/somi-deliver` for medium and large work, and plain SoMi for a small change. Only you can start it: the model does not call it on its own. See [Workflows](workflows.md#preparing-work-with-somi-brief).

## /somi-deliver

`/somi-deliver <the work, or a ticket>` runs the work as SoMi's staged workflow: a scout, a plan of milestones, then a build, a check and a review for each, each stage on its tier, through to the end. It calls `somi_route` with `staged` true. With no text after it, it builds the brief `/somi-brief` saved. Only you can start it. On Copilot it needs `/experimental`. See [Workflows](workflows.md#running-work-in-stages-with-somi-deliver).

## /somi-review

`/somi-review [diff or PR]` reviews the current changes, or the diff or pull request you name, once, whether or not the diff calls for a review. It calls `somi_route` with the hint `review`.

## /somi-quality

`/somi-quality [commit | repo]` checks code against SoMi's quality limits. With nothing after it, it checks the whole branch since it left the main branch, which is what goes into a pull request. `commit` scores what a commit adds to the last one. `repo` reports on the whole codebase as it stands, for a cleanup or a refactor. The agent tells you what it found, worst first. If you ask for fixes, it refactors the code until it passes with the tests still green, and it never adds a `somi-gate-allow` exemption to get past it. See [Configuration](configuration.md#quality-limits).

## /somi-status

`/somi-status` shows the open plan or brief, decisions and findings. It calls `somi_route` with the hint `status`. Only you can start it.

## /somi-config

`/somi-config` shows and changes the models each tier uses and the quality limits, and checks the setup. It calls `somi_route` with the hint `config`. Ask it in plain words, for example "put the low tier on a cheaper model" or "connect jira:fetch-ticket to work-item.start". Before the agent writes a limit looser than the current one, it asks you. See [Configuration](configuration.md).
