---
description: "The push gate: run the full suite, then prepare the pull request text."
argument-hint: "[--push]"
---

`somi` means the CLI named in your session context, or `npx @skathio/somi`.

1. Run `somi check --full`. If it fails, report the failures and stop. Never push past a red suite and never weaken a test to get through it.
2. Run `somi pr` to print the pull request text from the journal.
3. Push and open the pull request only if the maintainer asked for that, by `--push` or in words. Never force-push.

Before a release, open the milestone with `--release-candidate` so it gets a review, and read `docs/BENCHMARK.md` for the release decision.
