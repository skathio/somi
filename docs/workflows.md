# Workflows

You talk to one agent, on the medium tier by default, the same as a bare agent. SoMi keeps no workflow state, so nothing can be "still open" and nothing refuses your next request. What follows is what happens to each kind of request, in the order the README's "How it works" lists it.

```text
you talk to one agent, on the medium tier, the same as a bare agent
  -> a question, a follow-up, a change of mind: it just answers
  -> a small, clear change: it does it, as a bare agent would
  -> a ticket, large work, or a request that fits no obvious workflow: it asks somi_route once
  -> /somi-brief <feature>: a brief of numbered requirements, decisions and scope
  -> /somi-deliver <work or ticket>: a scout, a plan of milestones, and each milestone built and checked
  -> a turn that changed code ends: the quality gate runs, and the diff decides if a review is due
  -> somi_pr: refuses clean text for a change that needed a review and has none, or that fails the quality gate
```

## Questions and small changes

A question, a follow-up or a change of mind needs no tool call: the agent just answers. A small, clear change is done in place, in the conversation, as a bare agent would, with no routing call. On four tasks built over four messages each, a follow-up cost a bare agent about two cents, and sending one to a cheaper worker cost more than that in routing, briefing and checking, so small work stays where it is.

## Routing with somi_route

A ticket, large work, or a request that fits no obvious workflow gets one call to `somi_route`, with the request written to read on its own. It returns the workflow as a short list of steps. Each step says whether it runs in the conversation or on a subagent, on which tier, and with which brief. A debug is reproduce, fix and review; a plan is plan, milestones and close.

Routing classifies what the work is, never how big it will be. Rules decide a clear request. A request that matches several kinds goes back to the agent to choose, and one that matches none goes to build, with the other routes named so the agent can ask again with a hint. The tool takes a `sensitive` flag, for work you call security-sensitive, and that flag can only raise a tier.

Code is written on medium, in the conversation or in `/somi-deliver`'s build. The low tier does what needs no judgement, such as finding the files and running the checks. Work that needs more, such as design, goes up to a worker on the high tier. For large work, the agent does it on medium too, and tells you that `/somi-deliver` runs it in stages.

## Preparing work with /somi-brief

`/somi-brief <feature>` prepares a new feature or an improvement before anyone builds it. The agent reads the code, asks you only what the code cannot settle, and, once you approve, saves a brief of numbered requirements, decisions, scope and acceptance checks to `.somi/brief.md`. Nothing is built. The brief says whether `/somi-deliver` or plain SoMi should build it: `/somi-deliver` for medium and large work, plain SoMi for a small change.

A brief holds at most 200 lines, 16 KB and 40 requirements. SoMi refuses to save one with no goal, no numbered requirements, no handoff, or questions still open, because a brief that leaves a choice open sends the builder back to guessing. Its decisions go to the ledger as it is saved.

## Running work in stages with /somi-deliver

`/somi-deliver <work or ticket>` runs large work as SoMi's staged workflow. Only you can start it. Typed with nothing after it, it builds the open brief. The stages run in code, so each one gets its tier and none can be skipped:

1. **Scout:** on the low tier, it reports the files, the test command, the size of the change and facts about the code. For a bug, a reproduction is kept only if running it fails.
2. **Plan:** on medium, the work is split into milestones. It keeps to one milestone unless the work is several hundred lines or the request names stages, and it names the request lines each milestone covers. A request line no milestone took is added to the last one.
3. **Rules and build:** for each milestone, your rules are written as tests on medium, then the build runs on medium.
4. **Check:** the checks report each command's exit code, and the code reads them. A failed check gets one repair on the same tier, then one build a tier up.
5. **Trace:** once every milestone is built, every line of the request is checked against the code. A line still unmet gets one build a tier up.
6. **Review:** the reviewers the diff needs read the whole change, each on its tier.
7. **Harden:** on high, the findings are fixed at every severity, with what the request implies but never states. A fix that would change stated behaviour comes back to you as a decision.
8. **Final check:** every rule test runs, each rule file is confirmed unchanged, and the project's suite runs. A Blocker or Major the last review still finds gets one round of fixes.

Each of these is one attempt, so the run cannot loop. A blocked or unfinished milestone stops the run and comes back to you. The run is done only with every milestone built, the checks passing, no open Blocker or Major and nothing awaiting a decision.

On Copilot, `/somi-deliver` needs `/experimental`. See [Hosts](hosts.md).

## The quality gate at the end of a turn

When a turn that changed code ends, on Claude Code and Copilot CLI alike, SoMi runs the quality gate on the branch and sends anything over a limit back to the agent to fix, before any review. The agent never adds an exemption to get past it: that is yours to decide. The limits, and how to change them, are in [Configuration](configuration.md#quality-limits).

## The review decision

The same end-of-turn hook reads the real diff and says whether a review is due. A review runs only if a signal fired on the diff, the work is always reviewed, or you ask for one with `/somi-review`. The agent then calls `somi_review`, which names the one reviewer and its brief, and records the report.

| Diff | Reviewer |
|---|---|
| A review signal, such as a schema change, weakened tests or a new dependency | The code reviewer, on medium |
| A security signal, such as a sink, secrets, network or access control | The security reviewer, on high, which also reviews the rest of the change |

When the diff touches a security sink, the security reviewer runs on high, and every fix stays in the conversation, on medium. A Blocker, or a Major with a boundary flag, a line and evidence, blocks the change. A Minor, a Nit, an unconfirmed Major or an approve-with-comments never does. After two passes, or when the same blocking finding comes back, the agent takes it to you. The full policy is in [the architecture](ARCHITECTURE.md#review-policy).

## The pull request text with somi_pr

`somi_pr`, or `/somi pr` in the chat, writes the pull request text. It is the one place SoMi can refuse. It will not write clean text for a change that:

- fired a signal and has no review covering it,
- has an open blocking finding, or
- fails the quality gate.

To go ahead without the review, `somi pr --unreviewed` writes the text anyway, with a label at the top that a reader cannot miss. Nothing goes ahead below the quality bar. A review covers later changes only while they fire no signal of their own, so a follow-up on a sink needs its own review.
