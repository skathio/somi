---
name: owasp-defense
description: Use when the work touches authentication, authorization, cryptography, secret handling, input validation, deserialization, file uploads, template rendering, outbound HTTP triggered by user input, or any sensitive sink. Provides concrete defenses for the OWASP Top 10 mapped to actionable code-level checks.
---

# OWASP defense — practical checks

This skill is the **operational** companion to [`rules/30-security-owasp.md`](../../rules/30-security-owasp.md).
Pull it in when you are *writing* or *reviewing* code in security-sensitive territory.

## Trust boundary → sink walk

Every security finding starts with the same question: **untrusted data crosses what boundary, and where
does it end up?** When you load this skill, do this walk:

1. **Identify each ingress**: HTTP body, query, headers, cookies; queue message; file from disk/S3;
   third-party webhook; gRPC field.
2. **For each ingress, identify the sinks** the value can reach:
   - SQL query → A03 injection
   - Shell command → A03 command injection
   - HTML template → XSS
   - File path (`open`, `read`, `unlink`) → path traversal
   - URL for outbound HTTP → SSRF
   - Deserializer (YAML, pickle, etc.) → A08
   - Hash/compare with user-supplied token → timing / A02
   - Log line → log injection
3. **At each sink**: is the input parameterized / encoded / validated for that sink's grammar?
4. **Before the sink**: is authorization checked? Is the caller allowed to do this on this resource?

## Per-category quick checks

### Injection (A03)

- **SQL**: parameterized queries, prepared statements, ORM with bind variables. Never string-concat user
  input. Whitelist column/table names if dynamic.
- **Shell**: `execFile`/`spawn` with an args array. Never `sh -c <user-input>`. If you must, refuse
  user input.
- **NoSQL**: type-check; reject operator-typed inputs (`{$gt: ...}`) when a string is expected.
- **LDAP**: escape per RFC 4515.
- **Templating**: use the template engine's auto-escape; never `safe`/`raw` user data.
- **Headers**: reject `\r\n` in any header value built from input.

### AuthZ (A01)

- **Default deny.** Every endpoint declares who's allowed.
- **Check at the resource, not just the route.** "Can user U access resource R?" not just "is U logged in?"
- **No tenant cross-leak.** Tenant ID in the URL/path must match the caller's session — don't trust it
  blindly.
- **IDOR**: any reference to a resource by ID must be authorized for *this caller*.

### Crypto (A02)

- **Random**: `crypto.randomBytes` / `secrets.token_bytes` — not `Math.random`, not `random.random`.
- **Hash for passwords**: argon2id (preferred), bcrypt, scrypt. Never SHA*.
- **Hash for integrity**: SHA-256+, BLAKE2/3, or HMAC for keyed.
- **Compare**: `crypto.timingSafeEqual` / `hmac.compare_digest` for any secret-bearing comparison.
- **Don't roll your own.** No custom KDF, no custom protocol.

### Secrets

- **Never in source, logs, errors, metric labels, traces, URLs.**
- **Scoped & rotated.** Least privilege per service. Rotation tooling exists before you store the secret.
- **Local dev** uses `.env.example` placeholders; real values via secret manager / `direnv` /
  vault — not committed.

### Deserialization (A08)

- **Allowlist formats**: JSON with schema validation; protobuf with known fields; MsgPack with explicit
  decoder.
- **Block dangerous formats**: pickle, Java native serialization, unsanitized YAML (`yaml.safe_load` only).
- **Validate the schema** before the type system trusts the value.

### SSRF (A10)

- **Egress allowlist** for any outbound HTTP triggered by user input.
- **Block link-local, loopback, metadata IPs** (`169.254.169.254`, RFC1918, `127.0.0.0/8`, `::1`,
  `fe80::/10`).
- **Resolve once, connect to the resolved IP** to defeat DNS rebinding.
- **Cap redirects** and re-validate each hop.

### XSS

- **Output-encode at the sink**, not at the boundary. HTML escape for DOM, JS escape for `<script>`
  contexts, URL escape for href/src.
- **Avoid `dangerouslySetInnerHTML` / `v-html` / `{{{ }}}`** with user data.
- **CSP** as defense-in-depth (script-src 'self' + nonces; no unsafe-inline; no wildcard).

### File handling

- **Path traversal**: resolve to absolute, then check the result is under the allowed root. Reject `..`,
  null bytes, and absolute paths in user input.
- **Uploads**: server-side content-type sniffing, size limit, virus scan if user-shared, store outside
  the web root, serve via signed URL or proxy with `Content-Disposition: attachment`.
- **Image processing**: ImageMagick et al. have a vulnerability history. Constrain formats; use a
  sandboxed processor.

### Auth & sessions (A07)

- **Library, not bespoke.** Use the framework's session/JWT story.
- **Rotate on privilege change** (login, role change). Invalidate on logout.
- **Idle + absolute timeouts** for high-privilege scopes.
- **Rate-limit credential endpoints**; protect against enumeration (uniform error messages, uniform
  timings).
- **MFA on admin paths.**

### Logging (A09)

- **Log security-relevant events**: authn outcomes (success/fail), authz denials, admin actions,
  config changes.
- **Don't log**: passwords, tokens, full PII for credential endpoints, raw cookies, raw request bodies of
  sensitive endpoints.
- **Structured + correlation ID + central sink.**

## Common bug patterns to recognize on sight

- `if user.is_admin == True: ...` written but never *called* on a path.
- `os.path.join(BASE, user_input)` without realpath check.
- `requests.get(user_url)` without SSRF guards.
- `eval(...)`, `Function(...)`, `subprocess.Popen(..., shell=True)`.
- `==` for token comparison.
- `setTimeout(<inline string>)`.
- A regex used for HTML, SQL, or URL parsing.
- `random.choice` / `Math.random` generating a token.
- `JSON.parse` of `req.body` with no schema; then field access without type checks.
- A redirect URL taken from a query parameter without an allowlist.

## When to invoke `security-reviewer`

Loading this skill means *you are aware*. It does not replace the [`security-reviewer`](../../agents/security-reviewer.md)
agent. Invoke that agent when:

- The change introduces a new ingress or sink.
- The change touches auth, crypto, or secrets handling.
- You found a pattern from the list above and want a second pair of eyes.

This skill is the *checklist in your head*; the agent is the *audit*.
