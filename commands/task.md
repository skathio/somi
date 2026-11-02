---
description: "Do one piece of work the bare-first way: code it, check it, and get a review only if the real diff calls for one."
argument-hint: "<what to do>"
---

Do the work in `$ARGUMENTS` yourself, in this thread. `somi` means the CLI named in your session context, or `npx @skathio/somi`. Never edit anything under the SoMi state folder.

1. Run `somi step open --title "<short title>"`. Add `--ask "<question>"` only if the request itself names an expensive-to-reverse choice: schema, public API, storage, auth model, a breaking change. Add `--follow-up <area>` if this continues earlier work in that area.
2. Write the code and its tests.
3. Run `somi step after-code`. It runs the fast gate and reads the real diff. Then follow the `next` field of its answer:

- **`code` or `fix`:** fix what it lists, then repeat step 3.
- **`review`:** start each listed reviewer as a fresh subagent, with the listed `model` when there is one. Give each only `card.diff`, `card.prompt` and the acceptance test or command, never this conversation. Send their JSON, unedited, as an array: `somi step after-review` on stdin. Follow its `next`.
- **`close`:** commit, then run `somi step close`.
- **`ask`:** stop. Show the maintainer the `question` and end your turn. Record the answer later with `somi step decide --text "<their words>" --then continue|close|abort`. Never answer it yourself, and in an unattended run stop and report.

If a finding is marked `needs_verification`, it asks to remove a safety check. Weigh it against the threat model before acting. Minor and Nit findings are logged for you and never re-loop.
