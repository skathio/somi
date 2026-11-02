---
description: "Review the current diff, or a named diff or PR, once, on request."
argument-hint: "[diff, branch or PR] [--security]"
---

Start `somi-reviewer` as a fresh subagent on `$ARGUMENTS`, or on the current changes if none are named. Add `somi-security-reviewer` if `--security` is given or the diff touches a trust boundary. Give them the diff and the acceptance criteria, not this conversation.

Report their findings by severity, then stop. Do not fix anything or re-review unless asked. Inside a `/task` milestone, the state machine dispatches review for you, so this command is not needed there.
