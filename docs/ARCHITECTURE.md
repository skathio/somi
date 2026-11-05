# Architecture

SoMi 5.0 keeps what SoMi is for, routing any request to the right workflow, and takes the cost out. A thin coordinator asks a step engine what to do next, and workers do the work on the tier the route calls for.

## The loop

```text
request or ticket
  -> somi_step route: rules decide a clear request; otherwise the coordinator picks from a short table
  -> small and clear: one low-tier worker codes, then runs `somi finish`
       `somi finish`: runs the fast gate, reads the real diff, computes signals, commits if nothing else is due
  -> signal: one fresh reviewer, plus a security reviewer on a trust boundary
  -> Blocker, or a boundary Major a critic confirms: fix, then re-review the fix diff only
  -> anything else: logged
  -> checks fail twice: restart one tier up with the working tree and a short summary, once
  -> too big for one sitting: the worker splits it, the maintainer approves the parts, and each gets a fresh worker
```

The coordinator's prompt holds no procedure. Each answer from the engine names one `next` action and says `how` to carry it out, so what it reads is what it needs at that moment. A worker ends its own step because every turn the coordinator does not take costs the session's model and not the worker's.

Routing classifies what the work is, never how big it will be, because model size forecasts ran 2 to 8 times too high. Rules alone scored 41% on fresh phrasings, so anything they cannot place goes to the coordinator, for one extra turn and no extra agent.

A route starts at its lightest form and only observed evidence raises it. Escalation restarts instead of continuing, because a strong model continuing a cheap model's run recovers less of the quality gap than starting clean.

## Workflows and the library

`scripts/lib/workflows.mjs` says what each route runs: its kind, tier, role brief and skills. Role briefs are in `library/roles/`, expertise in `library/skills/`, and review lenses in `library/lenses/`. A host lists only commands and `somi-expertise`, at most 15 entries and 8,000 characters, and a test holds that, because hosts silently drop descriptions past a budget. Nothing in the library costs anything until it is used.

An addition has to earn its place with a paired test: at least 15 points on 15 tasks, no regression on control tasks, and at most double the tokens. Existing items get one model generation before the same test applies.

## State

The tools write everything under `.somi/state/`. The protected-path hook denies a model's writes there.

- **`journal.jsonl`:** append-only, one event per transition: `route`, `plan`, `open`, `check`, `after-code`, `after-review`, `critic`, `escalate`, `halt`, `decide`, `close`, `finish`, `migrate`.
- **`ledger.md`:** decisions, constraints and the current step, at most 40 lines and 6 KB. Compaction drops rules and scope limits first, and what gets re-injected survives, so this comes back at every session start and at the top of every brief. It is the only state re-injected.
- **`state.json`:** a cursor derived from the journal. It can always be rebuilt.

`.somi/plan.md` holds an approved plan, at most 200 lines and 16 KB. `somi status` and `somi pr` render every other view on demand. There are no progress or diary files, because an oversized state file is its own failure: one 4.x plan reached about 300,000 tokens of state.

A retried transition appends nothing and returns its earlier answer. Killing the process at any transition and resuming leaves a byte-identical journal, and `tests/kernel.test.mjs` proves it at each write point. SoMi assumes one agent per working tree, with no parallel writers: parallel work belongs in separate worktrees, which each have their own state.

## Review policy

| Rule | Value |
|---|---|
| Review at all | Only if a signal fired, or the milestone is a release candidate |
| Reviewers | One on the low tier, plus a security reviewer on the high tier on a boundary. A project's config cannot lower these |
| What re-loops | A Blocker, or a Major with a boundary flag, a line and evidence |
| What never re-loops | Minor, Nit, unconfirmed Major, approve-with-comments |
| Tested fix | The security reviewer's Minor and unconfirmed Major findings get one fix while a pass is left, and only what a failing test proves is fixed. A critic's rejection or a finding that asks to remove a check rules it out |
| Passes | Two, the second scoped to the fix diff. A third needs the maintainer |
| Circuit breaker | The same blocking fingerprint in two consecutive passes stops and asks |
| Relay check | A finding that suggests removing a check, flag, validation or test is marked `needs_verification` |
| Area follow-up | The second follow-up in one area stops and asks |

These are constants in `scripts/lib/policy.mjs`. A committed project config is untrusted, so none of them is configurable. Config may add sensitive paths, and it cannot remove a built-in signal.

## Signals

`scripts/lib/signals.mjs` reads the actual diff, and only raises.

- **Review signals:** `schema`, `tests-weakened`, `dependency`, `goldens-moved`, `unreadable-diff`. `multi-module`, `public-api` and `large-diff` are recorded but do not start a review.
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

Low, medium and high, mapped to models per environment in config. Claude Code has defaults. Copilot has none, because its models vary by plan, and an unmapped tier inherits the session's model and says so. A `ceiling` caps every tier.

| Role | Tier |
|---|---|
| Small implementation, tests, first review | low |
| Real issues, planning | medium |
| Design, security review, critic, escalated retries | high |
| Coordinator | the session's model |

A plugin cannot change the coordinator's model, so that is where a session's cost concentrates, and the coordinator is kept to a few turns for that reason.

The `apply-tier` hook sets a subagent's model at every level, because a tier that depends on an agent's cooperation gets skipped, and a nested worker otherwise falls back to the session's model. It rewrites and never denies, because a denied agent on Copilot does the work inline instead. `keep-work-delegated` denies main-thread edits during a code workflow on Claude Code only, because a denied agent on Copilot gives up. Both are cost controls and not security boundaries: a shell command can still write.

Only billing proves a tier. On a Copilot account using automatic model selection, a live run reported a worker on a cheaper model and billed all of it to the session's. The benchmark therefore reads spend per model from each result.

## Shards

`somi slot <step> <plugin:component>` inspects an installed plugin and writes a binding to config. There is no typed contract, because a model consumes the output and tolerates drift a schema would reject, and SoMi's own check handles what matters:

| State | Read shard | Write shard |
|---|---|---|
| Unchanged | Runs | Asks, then runs |
| Plugin updated | Runs, and says so | Held until confirmed |
| Component gone | Skipped with a notice | Skipped with a notice |
| Committed in a project, unconfirmed | Skipped until `somi slot --confirm` | Same |

Shard output reaches a worker as data under a plan already fixed. SoMi never installs a plugin for you.

## Left out on purpose

- **Size forecasts before coding.** They were wrong too often to route on.
- **A dashboard and parallel work items.** Deferred, not rejected.
- **Generated context files.** Studies show they raise cost and lower success.
- **Skills that restate what a current model knows.** Most software-engineering skills measured no effect, and the harm came from templates.
