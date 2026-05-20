---
name: threat-modeling
description: Use when introducing a new attack surface — a new external integration, webhook, file upload, OAuth flow, or service exposed to a less-trusted zone. Walks STRIDE / data-flow / trust-boundary frames to surface threats before code lands.
---

# Threat modeling — light-touch

Full enterprise threat modeling is heavy. This skill is for the engineer-scale case: *we're introducing a
new surface and we want to think about how it gets abused, before we ship*. 30–90 minutes of structured
thinking, not weeks.

Pair with [`owasp-defense`](../owasp-defense/SKILL.md) (which is about mitigations) and
[`security-reviewer`](../../agents/security-reviewer.md) (which does the deep audit).

## When to threat-model

- Adding a new public endpoint or webhook.
- Adding an integration with a third party (we call them, they call us, or both).
- Adding a file upload, file processing, or attachment feature.
- Adding an authentication mechanism (OAuth provider, SSO, API keys).
- Crossing a new trust boundary (introducing a new service, opening a new port).
- Storing or transmitting a new class of sensitive data (PII, payment, health, secrets).

## The light-touch process

### 1. Draw the data flow

A whiteboard sketch is fine. Identify:

- **External actors**: users, third-party services, attackers (named ones if relevant).
- **Processes**: the components doing work.
- **Data stores**: databases, caches, queues, file storage.
- **Trust boundaries**: where untrusted data becomes trusted (or moves between zones).

### 2. For each trust boundary, ask STRIDE

| Letter | Threat                       | Question                                             |
|--------|------------------------------|------------------------------------------------------|
| **S**  | Spoofing                     | Can someone pretend to be a legitimate actor?       |
| **T**  | Tampering                    | Can data be modified in flight or at rest?          |
| **R**  | Repudiation                  | Can an actor deny an action without us proving it?  |
| **I**  | Information disclosure       | Can an attacker read what they shouldn't?           |
| **D**  | Denial of service            | Can the surface be overwhelmed or held open?        |
| **E**  | Elevation of privilege       | Can a low-privilege actor act as high-privilege?    |

Not every category applies to every boundary. Skip what's clearly N/A; document what's not.

### 3. For each threat, decide

- **Mitigate**: what's the control? (Auth, validation, rate limit, signing, encryption, allowlist…)
- **Accept**: why is it not worth mitigating? (Cost, threat model assumption, defense in depth elsewhere.)
- **Transfer**: who else handles this? (Third-party WAF, framework, library, ops layer.)
- **Avoid**: change the design to eliminate the surface.

### 4. Write it down

Even a one-page note that lives next to the code. Future you / on-call / the next reviewer will thank you.

## Per-surface checklists

### New webhook endpoint (we receive)

- **Authn**: signature verification (HMAC of body), or mTLS, or shared secret. Constant-time comparison.
- **Replay**: timestamp in signed payload, reject outside ±5 min; idempotency key for dedupe.
- **Source allowlist** if practical (e.g., known IP ranges from the sender's docs).
- **Body limits**: max size, max nesting depth.
- **Schema validation** before parsing into typed objects.
- **Rate limit** per sender principal.
- **Observability**: log every webhook with a correlation ID; metric for accept/reject/duplicate.

### New file upload

- **Size cap** at the proxy *and* the handler.
- **Content-type sniff server-side** — don't trust the client's `Content-Type` or extension.
- **Antivirus / sandboxed processing** if user-shared.
- **Storage location** outside the web root; serve via signed URL or proxy with
  `Content-Disposition: attachment`.
- **Filename safety**: don't use user-supplied filename for storage path; canonicalize.
- **Path traversal** on any path construction.

### New OAuth / SSO integration

- **PKCE** for public clients.
- **State** parameter, validated server-side.
- **Redirect URI allowlist**, exact-match.
- **Validate `iss`, `aud`, `exp`, `nbf`, signature** on every token; never trust the JWT body without signature check.
- **Token storage**: HttpOnly + Secure + SameSite for browser; secret manager for backend.
- **Refresh rotation**: rotate refresh tokens; revoke on suspicious refresh.

### New third-party integration (we call them)

- **Egress allowlist**: if user input controls the URL, see SSRF in `owasp-defense`.
- **Timeouts**: every outbound call has a timeout and a circuit-breaker policy.
- **Auth at rest**: their credentials in secret manager; rotated; scoped.
- **Failure mode**: what happens when they're down? Degraded UX, queued retry, hard fail?
- **Data leaving the boundary**: what PII / business data are we sending? Is the contract OK?

### New service in a less-trusted zone

- **Authn between services**: mTLS, SPIFFE, signed JWTs from a known issuer.
- **AuthZ checks** at the service edge — don't assume the caller already authorized.
- **Network policy**: only allow the specific routes/IPs needed.
- **Secret access**: scoped to this service; no shared credentials with other services.

## Threat-modeling failure modes

- **Whiteboard theatre.** Sketching, but never writing down mitigations. The artifact matters.
- **Catastrophizing.** Listing every CVE that could conceivably apply. Focus on *this surface*.
- **Underestimating the platform.** "Anyone can read this!" — is it behind auth? Inside the VPC?
- **Not revisiting.** Threat model when the design is set, and again when the design changes.

## When to escalate

- **High-impact surface** (auth, payments, PII at scale): escalate to `security-reviewer` for the audit
  pass, in addition to this skill.
- **New architecture**: pair with `architecture-reviewer` to ensure the threat model and the
  architecture stay in sync.
