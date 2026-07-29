# Spec — expired-token

## 1. Purpose

`verifyToken()` accepts tokens whose `exp` has passed. Any caller relying on it for authorisation
is authenticating expired credentials.

## 2. Requirements

- **R1** — `verifyToken()` rejects a token whose `exp` is in the past.
- **R2** — Existing behaviour is unchanged for valid tokens, bad signatures, and malformed input.
- **R3** — `verifyToken`'s export surface is unchanged.

## 3. Non-goals

- Refactoring `session.mjs`'s overlapping expiry check.
- Any change to the signing scheme.

## 5. Core decisions

None outstanding — the fix shape is an implementation choice.
