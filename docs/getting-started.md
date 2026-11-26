# Getting started

SoMi is a plugin for Claude Code and GitHub Copilot CLI. You tell it what you want, in plain words or as a ticket, and it picks the right workflow and keeps the cost down. You keep talking to your own agent the whole time: it can read, answer and change its mind, and SoMi advises instead of taking over.

## Install

On Claude Code, type these in a session:

```text
/plugin marketplace add https://github.com/skathio/somi
/plugin install somi@somi
```

On GitHub Copilot CLI, run these in a terminal:

```bash
copilot plugin marketplace add https://github.com/skathio/somi
copilot plugin install somi@somi
```

If a SoMi 4.x install is still there, remove it first: when both load, both sets of hooks and skills run. On Copilot, `copilot plugin list` shows which version is installed. The [migration guide](MIGRATING-TO-5.md) has the rest.

## Start a session with SoMi's agent

Start the host with SoMi as the session's agent:

```bash
claude --agent somi:somi
copilot --agent somi:somi
```

In a Copilot session that is already running, `/agent somi` switches to it. Outside SoMi's agent, plain prompts are not routed, and SoMi says so at session start.

## Start on your tier's model with somi launch

`somi launch claude` or `somi launch copilot` starts the host with `--agent somi:somi` and the model your global config sets for the conversation's tier. On Copilot it also adds `--experimental`, which `/somi-deliver` needs. Anything after the host's name goes to the host, and a flag you pass yourself, such as `--model`, is not added again. With no model set for that tier, the host starts on its own default and SoMi says so.

`somi launch` starts a new session, so it does not run inside the one you are in. Type `/somi launch` in the chat, or ask `/somi-config`, and the agent gives you the full command to run in a terminal, or to wrap in an alias or function of your own on Linux, macOS or Windows.

## Your first request

Everything is done from the chat. Ask for a change, a bug fix, a refactor, a plan, a design, a review, an upgrade or the pull request text in plain words, or paste a ticket:

```text
Add a --json flag to the export command, with a test.
```

A question or a small, clear change is answered or done in place, as a bare agent would. A ticket, large work, or a request that fits no obvious workflow gets one call to `somi_route`, which says which workflow fits and on which tier each step runs. When a turn that changed code ends, the quality gate runs on the branch, and the diff decides whether a review is due.

Then check the setup once: `/somi doctor` checks the hooks, the sandbox, the tier models and the host.

## Where to go next

- [Workflows](workflows.md): what happens to a request, from routing to the pull request text.
- [Commands](commands.md): every command and what it takes.
- [Configuration](configuration.md): the models for each tier and the quality limits.
- [Hosts](hosts.md): what differs between Claude Code and Copilot CLI.
- [Shards](shards.md): connecting another plugin to a step of SoMi's work.
- [Sandbox and trust](sandbox.md): turning on the sandbox and checking it holds.
