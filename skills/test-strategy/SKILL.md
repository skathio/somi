---
name: test-strategy
description: Use when deciding what to test, at what level, and how. Distinguishes risk-driven coverage from coverage-worship. Covers unit vs integration vs e2e choices, mocking policy, determinism, and what to intentionally not cover.
---

# Test strategy

The supporting agent is [`test-strategist`](../../agents/test-strategist.md). Load this skill when you
are *writing* tests for a change you're already coding. Invoke the agent when the test shape itself is
a problem.

## The first question: what's the risk?

Tests exist to catch failures that matter. Before adding any test, ask:

- **What can go wrong with this code?**
- **What's the consequence?** (User sees wrong number? Money moves wrongly? Data is lost? Latency
  spikes?)
- **How would I notice if it broke in production?**

Risk drives coverage. Trivial getters with high consequence (e.g., `isAdmin`) deserve tests. Complex
algorithms with low consequence (e.g., a debug formatter) may not.

## Pick the right level

| Concern                                          | Level         |
|--------------------------------------------------|---------------|
| Pure functions, branching, data shaping          | Unit          |
| Crossing a process boundary (DB, queue, HTTP)    | Integration   |
| User-visible journey across several components   | End-to-end    |

**Most projects need**: a healthy unit base + a handful of integration tests at seams + a small number of
e2e tests for golden paths. Inverted pyramids (lots of e2e, few unit) are slow, flaky, and expensive.

### When unit is enough
- Logic that is or can be made pure (no I/O).
- Behavior that's testable through the seam without crossing it (e.g., test a parser by giving it bytes,
  not by reading a real file).

### When integration is needed
- The value of the code is in **how it interacts with the seam** (e.g., a repository query against a real
  schema, a message producer's interaction with the queue).
- Mocking would hide the actual risk (you're mocking the part that matters).

### When e2e is needed
- The user-visible journey involves multiple components that have been individually tested but never
  exercised together.
- The risk is integration drift over time, not unit correctness.

## Mocking policy

The cardinal rule: **don't mock what you don't own.**

- **Don't mock** third-party SDKs, databases, HTTP clients you didn't write. Mocking these tests your
  understanding of their API, which is exactly the part you don't control.
- **Do mock** seams you own — interfaces you've defined for collaborators.
- **Prefer fakes you author** that implement the same contract as the real thing (in-memory repo, fake
  message bus). Cheaper than full integration; more honest than mocks.
- **Integration tests** for the real-thing interaction, when the risk is at that seam.

### Test signal anti-patterns

- **No assertion**: function called, test passes, asserts nothing useful.
- **Assertions on the mock's return value**: you're testing your mock.
- **Snapshot worship**: snapshot tests as the safety net for logic. Snapshots are great for output
  formats with stable shapes (HTML, JSON), bad for behavior.
- **Mock-the-world**: every collaborator stubbed, including pure ones. The test exercises stubs, not
  code.

## Determinism

Tests that "pass sometimes" are bugs in the test (or worse, in the code).

- **Time**: inject a clock; use a frozen clock in tests; never call `time.now()` directly in code under test.
- **Randomness**: inject a seed; use a deterministic source in tests.
- **Ordering**: don't depend on dictionary/map iteration order; sort if you assert on ordering.
- **Shared state**: each test starts from a known state. Tear down or use isolated databases / temp dirs.
- **Concurrency**: explicit synchronization; no "sleep then assert" races.

Flaky tests get **fixed**, not retried. A `--retry 3` flag is a tombstone for code quality.

## Test names

Tests document intent. Names should describe behavior in plain language:

- `test_user_with_expired_token_gets_401`
- `test_concurrent_writes_to_same_key_are_serialized`
- `test_rate_limiter_allows_burst_up_to_capacity_then_denies`

Not:

- `test_1`, `test_user`, `test_handler`, `test_works`.

## Diagnostic quality

When a test fails, the diagnostic should tell you what broke. Strategies:

- **One assertion per concept** (not one per test). A test can assert several things, but each should be
  a clear named expectation.
- **Helpful diff messages** — use libraries that print diffs for structured data, not just `assertEquals(a, b)`.
- **Name the variables in the test** for what they represent, not `a` / `b` / `result`.
- **Failure messages**: a custom message on critical asserts saves time.

## What to *not* cover

Stating non-coverage is part of the strategy. Examples:

- "We don't unit-test the `SELECT` SQL in `OrderRepository.findRecent` — integration test in
  `OrderRepositoryIT` exercises the real query."
- "We don't cover the 4xx branch of `httpClient.get` — we trust the library's tests for that."
- "Snapshot tests cover the HTML output; we don't unit-test the template rendering."

If you skip coverage **and don't say why**, you're hiding risk.

## Coverage-worship rejection

100% line coverage doesn't mean safe. 60% coverage of the risky paths is safer than 100% coverage of
getters. Aim for **coverage where it matters**, not coverage as a number.

## When to invoke `test-strategist`

- The codebase has poor seams and you can't write the tests you want without refactoring first.
- Tests are flaky and you suspect the design, not the test code.
- You're not sure whether to unit-test or integration-test something.
- You're about to mock something you don't own.

The agent thinks about test shape; this skill helps you write tests under a chosen shape.
