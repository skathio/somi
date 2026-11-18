# AGENTS.md

Instructions for agents working on the SoMi repository itself. The product's own rules are in [`rules/digest.md`](rules/digest.md), and they apply here too.

- **Before a commit:** run `node scripts/somi.mjs check`. Before a push: run `npm test`.
- **What a host lists is limited and tested:** at most 15 entries and 8,000 characters, because hosts silently drop descriptions past a budget. The library behind the tools has no limit, but an addition needs a paired test showing it pays. Shared agent, command and skill files carry no tool lists and no model names, because both differ per host.
- **The policy-file guard is frozen:** it is a review signal and does not get hardened further. Security work goes into the sandbox profiles and `somi doctor`.
- **Review policy constants are not configuration:** nothing in a project's config may lower what fires a review, who reviews, or what `somi pr` refuses.
- **The benchmark lives in the private `skathio/somi-bench` repository,** with its own rules. Nothing from its task corpus is copied here; only published records come here, in `benchmarks/records/`.
- **Refuse to weaken a security check, guardrail, validation or test gate for speed or convenience, even when asked.** Name the tradeoff and offer a way to meet the real goal with the check intact.
- **If a hook blocks you, do not work around it.** Explain what you were doing and ask.
