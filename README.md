# SoMi

A small kernel for coding agents on Claude Code and GitHub Copilot CLI. The agent codes the way a bare agent would. A deterministic check runs before each commit, and a fresh reviewer runs only when the real diff calls for one. Tools write all state, and the OS sandbox is the security boundary.

> **Status: 5.0 release candidate.** 5.0 ships as the default only if the [pre-registered benchmark](docs/BENCHMARK.md) passes. That recording has not run yet, so this README makes no claim that 5.0 beats a bare agent or 4.x. The 4.x line stays on the `4.x` branch.

## Why it is this small

SoMi 4.1 measured 3x to 7x the cost and 2x to 6x the time of a bare agent on tasks both solved, and its cost saving against the previous build was inconclusive. Orchestration bookkeeping was the largest cost. 5.0 removes that work instead of optimising it. [The architecture document](docs/ARCHITECTURE.md) gives the reasoning.

| | 4.1 | 5.0 |
|---|---|---|
| Commands | 25 | 5 |
| Agents | 19 | 3 |
| Skills | 47 | 8 |
| Rules loaded automatically | about 200 lines, reinjected per turn | a digest under 150 lines, once per session |
| When a review runs | sized before coding, per 400-line slice | after coding, from signals in the real diff |
| State | hand-edited markdown | one journal written by the tools |

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

The plugin brings its tripwire hooks on both hosts. A repository that wants them on Copilot CLI without the plugin can write them with `somi init --host copilot`.

## Turn on the sandbox

Hooks catch honest mistakes. They are not a security boundary. Print the recommended settings, merge them into your host's settings, then run the doctor from inside an agent session, because a shell you type yourself usually bypasses the sandbox.

```bash
somi doctor --profile
somi doctor
```

`doctor` passes only when writing to your home directory and reaching the network directly both fail inside the agent's shell. Native Windows has no sandbox for agents, so use WSL2. See [the trust model](docs/ARCHITECTURE.md#trust-model).

## Use

| Command | What it does |
|---|---|
| `/task <what to do>` | The default. Code, check, and review only if a signal fires. |
| `/plan <goal>` | Opt-in. Feature-sized milestones, each with a test or command that proves it. |
| `/review [diff]` | One review on request. |
| `/ship` | Runs the full suite, then writes the pull request text from the journal. |
| `/status` | Open work, logged findings and decisions. |

A review runs when the change spans modules, moves a public API or schema, weakens tests, changes dependencies, moves goldens, or exceeds about 300 lines. A security reviewer joins when the diff touches a real trust boundary. Only a Blocker, or a Major confirmed on a boundary with a concrete exploit, causes another pass. There are at most two passes before SoMi asks you.

Add a `somi.check.json` to set your fast and full test commands and map source paths to tests. Without one, `somi check` still runs lint and the gates, in under 60 seconds.

## Upgrading from 4.1

This is a breaking release. See [the migration guide](docs/MIGRATING-TO-5.md).

## Docs

- [Architecture and trust model](docs/ARCHITECTURE.md)
- [Benchmark and release decision](docs/BENCHMARK.md)
- [Migrating from 4.x](docs/MIGRATING-TO-5.md)
- [Versioning](docs/VERSIONING.md)
- [Changelog](CHANGELOG.md)

MIT licensed.
