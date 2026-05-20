# 30 — Security & OWASP defenses

Default to secure. Every change is reviewed through this lens, not just changes "in the security file."

## OWASP Top 10 — what to watch for

### A01 — Broken Access Control
- **Authorize at every boundary**, not just at the front door. A handler that calls another handler
  must still check authority.
- **Default deny.** New endpoints should require an explicit `@requires(...)` / middleware decision.
- **IDOR**: never trust an ID from the client without checking the caller is allowed to see/touch it.
- **No client-side authz.** Hiding a button is UX; the server must still refuse.

### A02 — Cryptographic Failures
- **Use the platform's crypto** (`libsodium`, `crypto.subtle`, `bcrypt`, `argon2id`). Never roll your own.
- **No `MD5`/`SHA1` for security purposes.** Use SHA-256+ for integrity, argon2id/bcrypt for password hashing.
- **TLS everywhere.** No plaintext for credentials, tokens, PII.
- **Secrets at rest**: encrypted, scoped, rotated. Never in source, never in logs, never in errors.

### A03 — Injection
- **Parameterize all queries.** No string concatenation into SQL, shell, LDAP, XPath, NoSQL filters, or templating.
- **Encode at output boundary** based on the sink: HTML escape for DOM, JSON-encode for JSON, URL-encode
  for URLs. Never trust "the framework will handle it" without verifying.
- **Shell: avoid invoking shells.** Prefer `execFile`/`spawn` with an args array. If you must use a shell,
  refuse user input.

### A04 — Insecure Design
- **Threat-model new surfaces.** New webhook? New file upload? New OAuth flow? Run the
  [`threat-modeling`](../skills/threat-modeling/SKILL.md) skill.
- **Trust boundaries are explicit.** Mark which inputs cross which boundary; validate at the crossing.

### A05 — Security Misconfiguration
- **No default credentials.** Ever.
- **Verbose errors stay server-side.** Clients get an opaque ID; logs get the trace.
- **CSP, HSTS, X-Frame-Options, X-Content-Type-Options** — turn them on, then loosen with intent.
- **CORS**: explicit allowlist, never reflect `Origin` blindly, never `*` with credentials.

### A06 — Vulnerable / Outdated Components
- **Lockfiles committed.** Renovate/Dependabot or equivalent.
- **No transitive surprises.** Track CVEs against current pins. Patch security issues with urgency.
- **Don't pull a library for a one-liner.** Each dep is attack surface.

### A07 — Identification & Authentication Failures
- **Use a real auth library.** Don't write session/cookie logic.
- **Strong session invariants**: rotate on privilege change, short idle timeout for high-privilege scopes,
  bind to client characteristics where the threat model supports it.
- **MFA for admin paths.**
- **Rate limit + account lockout** for credential endpoints; protect against enumeration.

### A08 — Software & Data Integrity Failures
- **Sign artifacts** in the release pipeline; verify signatures in CI/runtime where feasible.
- **No deserializing untrusted data** with formats that can construct arbitrary objects (pickle, Java native,
  unsanitized YAML). Prefer JSON with schema validation.
- **Pin CI actions/images to digests** for security-sensitive pipelines.

### A09 — Security Logging & Monitoring Failures
- **Log security-relevant events**: authn, authz failures, admin actions, configuration changes.
- **Never log secrets, tokens, full PII, raw request bodies for credential endpoints.**
- **Make logs queryable**: structured (JSON), correlated (request ID), and centralized.

### A10 — Server-Side Request Forgery (SSRF)
- **Egress allowlist** for any outbound HTTP triggered by user input.
- **Block link-local / loopback / metadata IPs** (`169.254.169.254`, `127.0.0.0/8`, `10.0.0.0/8`, etc.)
  unless explicitly required.
- **Resolve DNS once** and connect to the resolved IP to defeat DNS rebinding.

---

## Secure-by-default patterns

- **Whitelists over blacklists.** Specify what's allowed; reject everything else.
- **Idempotency keys** on state-changing public endpoints.
- **Constant-time comparison** for tokens (`crypto.timingSafeEqual` or equivalent).
- **Don't expose internal IDs** when an opaque slug is fine.
- **Principle of least privilege** for service accounts, IAM roles, DB users.
- **No `eval`, `Function()`, dynamic `import()`** of user-controlled strings.
- **Set timeouts** on every outbound network call and DB query.
- **Treat all error paths as logged paths.** A silent failure is a silent compromise.

## When in doubt

Pause and invoke the **`security-reviewer`** agent before merging. Auth, crypto, input validation, file
uploads, deserialization, and template rendering are five areas where "I think it's fine" loses outages.
