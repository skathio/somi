---
name: somi-checkpoint
description: The contract for a SoMi user gate when the procedure runs inside a subagent - return a CHECKPOINT block and stop, then continue from a RESUME block - plus the DONE, STOPPED and REROUTE result blocks. Loaded by somi-flow, somi-general and the somi dispatcher.
user-invocable: false
---

# somi-checkpoint — user gates across a subagent boundary

A subagent cannot ask the user anything: neither Claude Code nor Copilot gives a subagent a
question tool. SoMi procedures still need the user at fixed gates (a slug confirmation, a
`DECISIONS-NEEDED` round-trip, `/ship-loop`'s brief-handoff gate, `/pr`'s confirmation before
`gh pr create`, `/incident`'s framing). This skill is how those gates survive the boundary.

## Which mode you are in

- **Main conversation** — a slash command on Claude Code, or an agent the user selected for the
  session. Ask at each gate directly, exactly as the procedure says. This skill does not apply.
- **Subagent** — you were started with a briefing (`flow:` / `args:`, or `RESUME`). Every gate
  becomes a `CHECKPOINT`, below.

A gate is any step that tells you to ask, confirm, present something to the user, offer options,
or wait for a reply. Nothing else is a gate: never invent one to hand work back.

## At a gate: save, return, stop

1. **Save first.** Write everything the procedure would already have written up to this step
   (artifacts, diary entry, loop state). The next run starts from a fresh context and from disk.
2. **Return one `CHECKPOINT` block as your whole final message**, and stop:

   ````
   CHECKPOINT
   flow: <flow name>
   resume_at: <the heading of the step to continue from, verbatim>
   context: |
     <at most 10 lines: slug, iteration, loop run id, paths written, what is done>
   ask:
     - id: q1
       question: <one question>
       options:                       # omit for a free-text answer
         - <recommended option first, marked (recommended)>
         - <option>
       detail: |
         <what the user needs to choose well: pros/cons, the DECISIONS-NEEDED text verbatim>
   ````

   Several decisions from one `DECISIONS-NEEDED` block go in one `CHECKPOINT` (`q1`, `q2`, …),
   options and pros/cons kept verbatim, with `Other` and `Discover` offered as the planner's
   protocol requires.
3. Never answer your own question, never pick a default to keep going, and never mark a decision
   user-verified without a `RESUME` that carries the user's answer.

## When the caller resumes you

You get a fresh start whose briefing begins with:

````
RESUME
flow: <flow name>
resume_at: <as returned>
context: |
  <as returned, verbatim>
answers:
  q1: <the user's answer, verbatim>
args:
```args
<the original request, verbatim>
```
````

Load the flow skill again, check the disk state matches `context` (the artifacts exist, the loop
state is where it says), and continue from `resume_at`. If it doesn't match, return `STOPPED`
with what differs; never rebuild state from memory. An answer that doesn't fit the question
(the user changed their mind, asked something else) is a new gate: return a new `CHECKPOINT`.

## Result blocks

Every SoMi subagent run ends with exactly one of these as its final message:

| Block | When | Carries |
|---|---|---|
| `CHECKPOINT` | a gate needs the user | the shape above |
| `DONE` | the procedure finished | `flow:`, `summary:` (the procedure's own summary step), `artifacts:` (paths), `next:` (one step) |
| `STOPPED` | a gate fired or a step failed (cap breach, resolver error, refused agent type) | `flow:`, `reason:`, `outstanding:`, `next:` |
| `REROUTE` | `somi-general` only: the request is a SoMi workflow after all | `flow:` (the workflow), `why:` (one line), `args:` |

## The caller's side (the dispatcher)

- `CHECKPOINT` → put each `ask` to the user (the host's question tool, or plain text), with
  `detail` shown faithfully and nothing added or dropped, and end the turn. When the user replies,
  start the same agent with a `RESUME` block: `flow`, `resume_at` and `context` copied verbatim,
  `answers` from the user, and the original `args`. Never answer a checkpoint on the user's behalf,
  even in a session the host calls non-interactive: there, the questions are the final answer.
- `DONE` / `STOPPED` → relay `summary` / `reason` and `next` to the user.
- `REROUTE` → dispatch the named flow with `args`, after the usual one-line announcement.
- The user can say `stop` at any checkpoint: relay it as the answer; the flow records a user-stop.
