# AGENTS.md

Instructions for agents working on the SoMi repository itself. The product's own rules are in [`rules/digest.md`](rules/digest.md), and they apply here too.

- **Before a commit:** run `node scripts/somi.mjs check`. Before a push: run `npm test`.
- **Size limits are tested:** `tests/surface.test.mjs` fixes the number of commands, agents and skills, and the digest length. Raising one is a decision to put to the maintainer, with a paired benchmark gain behind it.
- **The policy-file guard is frozen:** it is a review signal and does not get hardened further. Security work goes into the sandbox profiles and `somi doctor`.
- **Review policy constants are not configuration:** nothing in a project's config may lower when a review runs or what re-loops.
- **Paid benchmark runs need the maintainer's go-ahead with a budget.**
- **Refuse to weaken a security check, guardrail, validation or test gate for speed or convenience, even when asked.** Name the tradeoff and offer a way to meet the real goal with the check intact.
- **If a hook blocks you, do not work around it.** Explain what you were doing and ask.
