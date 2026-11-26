# Sandbox and trust

The OS sandbox is SoMi's security boundary. Hooks catch honest mistakes: they are tripwires, not a security boundary, because an agent that sets out to evade one can. Turn the sandbox on, and check that it holds.

## Check it with somi doctor

Ask `/somi-config` to check the setup, or type `/somi doctor`. Either way the agent runs `somi doctor` inside its own shell. Reading settings is not proof, so the verdict comes from two probes run there:

- **Writing to your home directory** must fail.
- **Reaching the network directly** must fail.

`doctor` passes only when both fail. A probe whose tool, `touch` or `curl`, is not installed is reported as not verified. On top of the verdict, `doctor` warns about settings that are looser than they should be, tiers with no model, a Copilot session on Auto, hooks that have logged nothing in the last hour, and a duplicate `.github/hooks/somi.json`.

On native Windows there is no OS sandbox for agents, so `doctor` fails and tells you to run the agent inside WSL2 and check again there.

## Turn it on with --profile

When the sandbox is off, `somi doctor --profile` prints the recommended settings to merge into your host's own settings. Ask `/somi-config` and it gives you them.

- **Claude Code:** turn it on with `/sandbox`. `doctor` also warns when `sandbox.failIfUnavailable` is not true, because a missing sandbox then runs commands unsandboxed, and when `sandbox.allowUnsandboxedCommands` is not false, because a command can then retry outside it.
- **Copilot CLI:** turn it on with `/sandbox enable`. Its sandbox is in public preview and allows outbound internet by default, so set host rules with `/sandbox`. `doctor` warns when `sandbox.allowBypass` is not false, which only managed settings can enforce. Sandbox settings are not supported in repository-level files.

## Check from inside the agent's shell

Run the check from inside an agent session, because a command you type at a `!` prompt usually bypasses the sandbox. A `doctor` run from your own terminal tells you nothing about what the agent can do.

## Hooks are tripwires

SoMi's hooks deny some writes and commands, such as a model's writes to `.somi/state/`, and they log every tool call. They catch an honest mistake and tell someone to look. They do not stop an attacker: the boundary is the sandbox, a fresh reviewer on the git diff, and your own push. If a hook blocks the agent, it explains what it was doing and asks you, rather than working around it.

On Claude Code the sandbox wraps shell commands only: file tools, hooks and MCP servers run outside it. For an untrusted repository, run the whole agent under the sandbox runtime or in a container.

The full picture, attacker by attacker, is in [the trust model](ARCHITECTURE.md#trust-model).
