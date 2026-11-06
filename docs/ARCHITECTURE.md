# Architecture

SoMi 5.0 keeps what SoMi is for, picking the right workflow for any request, and takes the cost out. The agent holding the conversation stays in charge. SoMi advises through tools that keep no workflow state, and the only thing it can refuse is pull request text.

## The loop

```text
the user talks to one agent, on the tier set by tiers.main: medium by default, the same as a bare agent
  -> a question, a follow-up, a change of mind: the agent carries on, with no tool call needed
  -> work to do: somi_route, once, with the request written to read on its own
       it returns the workflow as steps, each with where it runs, main or a subagent, and on which tier
       rules decide a clear request; with no rule to go on, it is new work and goes to build
  -> code below the conversation's tier: down to a low worker, with a brief somi_route built
  -> the user said it is security-sensitive, or it is at the conversation's tier: done here
  -> above it: up to a worker, with a brief somi_route built
  -> the change is ready: somi_review reads the real diff, computes signals, and names reviewers with their briefs
  -> reviewers report: somi_review records them, and says what blocks the change from leaving
       security signals on the diff: the fix happens here, on the conversation's tier
  -> somi_pr: the gate
```

An earlier version made the agent a coordinator on a step engine: it could not read or answer, and each answer named the one thing it could do next. That was too restrictive in real use, and it lost context on sequential requests, because a new request was refused while work was open and a worker saw only the latest message. No benchmark caught it, because each draw was one prompt and an "Approved".

SoMi's founding comparison is a bare agent on the same tier: both hold the conversation on medium and do the whole job, and SoMi saves by moving what is cheaper down to low. In the first candidate's ablation, a medium coordinator with low workers and no review cost 0.89 times bare per draw (0.79 to 1.02). The cheap tier lost on money, accounts and untrusted input. Matching those words in a request kept 11 of 16 benchmark tasks on medium, so whether work is risky is read from the code instead: the diff's security signals call in the security reviewer, and any fix they lead to stays on medium. That follows the rule to raise a tier only on observed evidence, and it carries a known risk: a low worker's build can miss a safety case that review does not catch. The user can still say up front that work is sensitive.

Each workflow comes back as a short list of steps. A debug is reproduce, fix and review; a plan is plan, milestones and close. Each step says whether it runs on the main thread or on a subagent, and on which tier. That is SoMi 3.x's per-step dispatch, but computed for each request and kept nowhere, so it never stands between the user and the next message.

What a model would otherwise work out the same way every time is done by the tools. The worker's and the reviewers' briefs are built by them, so a model passing them on cannot reword the ticket or add an approach of its own. With no rule to go on, a request goes to `build` without a turn spent choosing. The diff decides the reviewers, a clean review is not asked for again while it still covers the change, and the plan file and pull request text have tools of their own.

Routing classifies what the work is, never how big it will be, because model size forecasts ran 2 to 8 times too high. Rules alone scored 41% on fresh phrasings, so anything they cannot place goes back to the agent to choose, for one extra call. The tool takes a `sensitive` flag because a follow-up's words may not say what it touches, and that flag can only raise a tier.

Advice in a tool result arrives at the moment of decision, which is where it is most likely to be followed. What must happen does not rest on advice: the session agent's model and the worker and reviewer hook are configuration, the safety hooks deny, and the review gate sits at `somi pr`.

## Workflows and the library

`scripts/lib/workflows.mjs` says what each route is: its kind, tier, role text and skills. Role text is in `library/roles/`, expertise in `library/skills/`, and review lenses in `library/lenses/`. A host lists only commands and `somi-expertise`, at most 15 entries and 8,000 characters, and a test holds that, because hosts silently drop descriptions past a budget. Nothing in the library costs anything until it is used.

An addition has to earn its place with a paired test: at least 15 points on 15 tasks, no regression on control tasks, and at most double the tokens. Existing items get one model generation before the same test applies.

## State

Nothing here steers the work. These files only remember what happened, so a new session, a compacted one and `somi pr` can read it. The tools write everything under `.somi/state/`, and the protected-path hook denies a model's writes there.

- **`reviews.jsonl`:** one line per review pass: the tree it covered, the verdicts and the findings.
- **`ledger.md`:** decisions and constraints that must outlive the context, at most 40 lines and 6 KB. Compaction drops rules and scope limits first, and what gets re-injected survives, so this comes back at every session start and with every route.
- **`prompt.txt`:** the user's latest message, kept by a prompt hook so that routing and briefs can read the user's own words. It is overwritten by every prompt and never leaves the machine.
- **`check.json`:** the last `somi check`, so a pull request can say whether the full suite passed on this code.

`.somi/plan.md` holds an approved plan, at most 200 lines and 16 KB, and `somi plan --done N` marks a milestone in place. `somi status` and `somi pr` render every other view on demand. There are no progress or diary files, because an oversized state file is its own failure: one 4.x plan reached 11 MB.

## Review policy

| Rule | Value |
|---|---|
| Review at all | Only if a signal fired, the work is always reviewed, or the user asks |
| Reviewers | One on the low tier, plus a security reviewer on the high tier on a boundary. A project's config cannot lower these |
| What blocks | A Blocker, or a Major with a boundary flag, a line and evidence |
| What never blocks | Minor, Nit, unconfirmed Major, approve-with-comments |
| Passes | Two. After that, or when the same blocking fingerprint comes back, the answer tells the agent to take it to the user |
| Relay check | A finding that suggests removing a check, flag, validation or test is marked `needs_verification` |

**The gate is at the outward step.** `somi pr` will not write pull request text for a change that fired a signal and has no review covering it, or that has an open blocking finding. `--unreviewed` writes it anyway, with a label at the top that a reader cannot miss. A review covers later changes only while they fire no signal of their own, and committing does not change that, so a follow-up on a sink needs its own review.

These are constants in `scripts/lib/policy.mjs` and `scripts/lib/reviews.mjs`. A committed project config is untrusted, so none of them is configurable. Config may add sensitive paths, and it cannot remove a built-in signal. The record is a tripwire like the hooks, because an agent that sets out to can forge it: the boundary is the sandbox and the maintainer's push.

## Signals

`scripts/lib/signals.mjs` reads the actual diff, and only raises.

- **Review signals:** `schema`, `tests-weakened`, `dependency`, `goldens-moved`, `unreadable-diff`. `multi-module`, `public-api` and `large-diff` are recorded but do not start a review.
- **Security signals:** `sink`, `secrets`, `network`, `repo-content`, `policy-file`, `sensitive-path`, `unreadable-diff`.

These signals are patterns over file names and added lines, so they over-fire by design and they cannot prove a taint path. They route attention and do not make anything safe.

## Gates

| Tier | When | Budget | Contents |
|---|---|---|---|
| `somi check` | Every commit | 60 s | Syntax, JSON and pipefail lint on changed files, conflict markers, planning-id and optional model-name gates on added lines, a readable review record, affected tests, and your `fast_cmd` |
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
- **SoMi's tools:** because MCP servers run outside the sandbox, they never run project commands. `somi check` runs in the sandboxed shell, and nothing depends on it having run except what the pull request text says.
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

Low, medium and high, mapped to models per environment in config. Claude Code has defaults. Copilot has none, because its models vary by plan, and an unmapped tier runs on the session's model and says so. `main` says which tier the conversation runs on, medium by default. A `ceiling` caps every tier.

| Role | Tier |
|---|---|
| The conversation, work the user calls sensitive, and fixes after a security signal | `main`, medium by default |
| Code work | low, on a worker |
| Real issues, planning | medium |
| Design, security review | high |
| First review | low |

`somi setup` writes the session's agent to the user's own agent folder, with the model for `tiers.main`, for a user who wants the conversation on a tier other than the session's. Shared files stay free of model names. On Claude Code a live check showed that model holding across follow-ups, with the conversation kept. Copilot CLI documents the same and it has not been confirmed live, because the account used for checks serves Auto only.

The `apply-tier` hook sets a SoMi worker's or reviewer's model from its name, so it needs no state and a tier does not depend on an agent remembering it. It rewrites and never denies, because a denied agent on some hosts does the work inline. On Claude Code it also keeps those agents in the foreground, because one in the background cannot ask for a permission, so a reviewer's diff command is denied and it reviews blind.

What each host does with these:

| Mechanism | Claude Code | Copilot CLI | VS Code |
|---|---|---|---|
| Session agent's `model` | Holds across follow-ups, and `--model` overrides it | Documented to outrank `--model` | The agent dropdown applies it |
| Worker above the main model | Runs | Runs, unless the session is on Auto | Refused, and the subagent does not run |
| Named model not available | Falls back by alias rules | Falls back to the session's model silently | Reports which models are available |
| A real fork keeps the conversation | Yes, on the same model as the parent | Session fork only | No |

Only billing proves a tier. On a Copilot account using automatic model selection, a live run showed a worker's completion event naming its configured model while its model calls went to the one Auto chose. The benchmark therefore reads spend per model from each result.

## Shards

`somi slot <step> <plugin:component>` inspects an installed plugin and writes a binding to config. There is no typed contract, because a model consumes the output and tolerates drift a schema would reject, and SoMi's own check handles what matters:

| State | Read shard | Write shard |
|---|---|---|
| Unchanged | Runs | Asks, then runs |
| Plugin updated | Runs, and says so | Held until confirmed |
| Component gone | Skipped with a notice | Skipped with a notice |
| Committed in a project, unconfirmed | Skipped until `somi slot --confirm` | Same |

Shard output is treated as data, under a plan already fixed. A named step reaches its shards when SoMi's tools answer for that step. SoMi never installs a plugin for you.

## Left out on purpose

- **A step engine, a journal and a workflow cursor.** See the top of this page.
- **Size forecasts before coding.** They were wrong too often to route on.
- **A dashboard and parallel work items.** Deferred, not rejected.
- **Generated context files.** Studies show they raise cost and lower success.
- **Skills that restate what a current model knows.** Most software-engineering skills measured no effect, and the harm came from templates.
