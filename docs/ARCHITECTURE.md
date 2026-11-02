# Architecture

SoMi 5.0 is a bare-first default lane plus a thin state machine that writes all state as a side effect.

## The loop

```text
intent
  -> ask once, only if the request names an expensive-to-reverse choice
  -> code in the main thread
  -> somi step after-code: runs the fast gate, reads the real diff, computes signals
  -> no signal: commit and close
  -> signal: one fresh reviewer, plus a security reviewer on a trust boundary
  -> Blocker or confirmed boundary Major: fix, then re-review the fix diff only
  -> anything else: logged, then commit and close
  -> full suite before push
```

A milestone is one feature, built and tested together. There is no line cap on it and there are no slices.

## State

The tools write everything under `.somi/state/`. The protected-path hook denies a model's writes there.

- **`journal.jsonl`:** append-only, one event per transition: `open`, `check`, `after-code`, `after-review`, `decide`, `close`, `migrate`.
- **`state.json`:** a cursor derived from the journal. It can always be rebuilt.

`somi status` and `somi pr` render every view on demand. There are no progress, diary or decision files.

A retried transition appends nothing and returns its earlier answer. Killing the process at any transition and resuming leaves a byte-identical journal, and `tests/kernel.test.mjs` proves it at each write point. SoMi assumes one agent per working tree, with no parallel writers: parallel work belongs in separate worktrees, which each have their own state.

## Review policy

| Rule | Value |
|---|---|
| Review at all | Only if a signal fired, or the milestone is a release candidate |
| Reviewers | One at the work tier, plus a security reviewer at the review tier on a boundary |
| What re-loops | A Blocker, or a Major with a boundary flag, a line and evidence |
| What never re-loops | Minor, Nit, unconfirmed Major, approve-with-comments |
| Passes | Two, the second scoped to the fix diff. A third needs the maintainer |
| Circuit breaker | The same blocking fingerprint in two consecutive passes stops and asks |
| Relay check | A finding that suggests removing a check, flag, validation or test is marked `needs_verification` |
| Area follow-up | The second follow-up in one area stops and asks |

These are constants in `scripts/lib/policy.mjs`. A committed project config is untrusted, so none of them is configurable. Config may add sensitive paths, and it cannot remove a built-in signal.

## Signals

`scripts/lib/signals.mjs` reads the actual diff, and only raises.

- **Review signals:** `multi-module`, `public-api`, `schema`, `tests-weakened`, `dependency`, `goldens-moved`, `large-diff`, `unreadable-diff`.
- **Security signals:** `sink`, `secrets`, `network`, `repo-content`, `policy-file`, `sensitive-path`, `unreadable-diff`.

These signals are patterns over file names and added lines, so they over-fire by design and they cannot prove a taint path. They route attention and do not make anything safe.

## Gates

| Tier | When | Budget | Contents |
|---|---|---|---|
| `somi check` | Every commit | 60 s | Syntax, JSON and pipefail lint on changed files, conflict markers, planning-id and optional model-name gates on added lines, journal schema, affected tests, and your `fast_cmd` |
| `somi check --full` | Every push | None | The above, plus your full suite |
| Release | Ship | None | The full suite, plus the benchmark |

Affected tests come from `somi.check.json`. A code file no key covers falls back to `full_cmd`, within the budget.

Mutation testing is diff-scoped and covers security-relevant code only: `npm run mutate` flips an operator on each changed line of the path, state, policy, signal and hook files, and names what the mapped tests missed. Run it before a push when one of those files changed.

## Trust model

A **boundary** stops an attacker. A **signal** only tells someone to look. SoMi keeps the two apart and stops hardening signals against the agent's own evasion.

| Attacker | Example | Boundary | Signals |
|---|---|---|---|
| Prompt injection in repository content | An issue tells the agent to pipe a download into a shell | OS sandbox, network allowlist, credential deny | Tripwire hooks, reviewer |
| A hostile cloned repository | Malicious `.claude/settings.json`, `.mcp.json`, git hooks | Sandbox-protected paths. Do not auto-trust MCP servers from a repository | Policy-file signal routes the security lens |
| The model itself | Evades a guard, edits its own policy, weakens a test | Sandbox, a fresh reviewer on the git diff, the maintainer's push | Hooks, escalation |

Limits to keep in mind:

- **Claude Code:** the sandbox wraps shell commands only. File tools, hooks and MCP servers run outside it. For untrusted repositories, run the whole agent under the sandbox runtime or in a container.
- **`somi_step`:** because MCP servers run outside the sandbox, this tool never runs project commands. `somi check` must run in the sandboxed shell, and otherwise `after-code` refuses with `check-required`.
- **Project commands:** `somi check` runs commands from `somi.check.json`, which a cloned repository can supply. That is the same trust as running its `npm test`, which is why it belongs inside the sandbox.
- **Copilot CLI:** the local sandbox is in public preview, allows outbound internet by default, and offers a bypass prompt that only managed settings can disable. A command hook that times out fails open. Sandbox settings are not supported in repository-level files, so set them with `/sandbox`.
- **Native Windows:** no OS sandbox for agents. `somi doctor` fails with the WSL2 remedy.

The sandbox is recommended, not required: session start warns loudly when it is off. It should become required once Copilot's sandbox leaves preview.

## Hosts

| Capability | Claude Code | Copilot CLI | VS Code and cloud agent |
|---|---|---|---|
| Default lane and CLI | Yes | Yes | Instructions only, CLI in a terminal |
| Tripwire hooks | Plugin `hooks/hooks.json` | The same plugin file, or `somi init --host copilot` for `.github/hooks/somi.json` | Not assumed in VS Code |
| OS sandbox | `/sandbox`, profile in `profiles/claude.json` | `/sandbox enable` | Host settings |
| Reviewer model tier | Per subagent | Host default unless config names one | Host default |

Hook denials exit 2, which both CLIs treat as a deny. Hook output carries both hosts' documented fields, because each ignores the other's.

## Tiers

Two tiers only, `work` and `review`, set per host:

```json
{ "tiers": { "claude": { "work": "sonnet", "review": "opus" } } }
```

Set them in `~/.config/somi/config.json` or `.somi/config.json`. The journal records the model each reviewer was told to run.

## Left out on purpose

Discovery and requirements documents, design briefs, pre-code sizing, panel review, parallel worktree orchestration, the dispatcher chain, diary and progress files, per-iteration line caps, and memory banks are all out. Each can return as an opt-in plugin only after it shows a paired benchmark gain. They remain on the `4.x` branch.
