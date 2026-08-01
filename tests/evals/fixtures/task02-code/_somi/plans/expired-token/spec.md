# Spec — expired-token

## 1. Purpose

`verifyToken()` accepts tokens whose `exp` has passed. Any caller relying on it for authorisation
is authenticating expired credentials.

## 2. Requirements

- **R1** — `verifyToken()` rejects a token whose `exp` is in the past.
- **R2** — Existing behaviour is unchanged for valid tokens, bad signatures, and malformed input.
- **R3** — `verifyToken`'s export surface is unchanged.
- **R4** — if the fix takes a clock, it is a **second positional parameter in epoch
  milliseconds**: `verifyToken(token, nowMs = Date.now())`. Reading `Date.now()` directly is
  equally acceptable; what is fixed is the shape *if* one is injected.

## 3. Non-goals

- Refactoring `session.mjs`'s overlapping expiry check.
- Any change to the signing scheme.
- Hardening `exp`'s type. A token whose payload carries no `exp` claim is out of scope for this
  iteration; treat a missing `exp` as it is treated today.

## 5. Core decisions

None outstanding — the fix shape is an implementation choice.
