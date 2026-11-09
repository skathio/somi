# Secure coding

Use when code handles input from outside the process, or touches authentication, authorization, secrets, files, or a sink such as SQL, shell, HTML or an HTTP request.

General reminders do little. Check each specific weakness that applies, and trace real input to the sink.

- **CWE-89, 78, 79, injection:** every sink is parameterized or escaped for its own context. Attribute, URL and script contexts escape differently from HTML text. Check values reaching the sink through a helper, not only direct ones.
- **CWE-22, path traversal:** resolve the real path, following links, and compare against the base with a trailing separator, because `/data-evil` starts with `/data`. Refuse `..`, absolute paths, backslashes and NUL. Check links already on disk, not just the given name.
- **CWE-601, open redirect:** allow only a path on your own origin. Refuse `//host`, `/\host`, control characters and `user@host` forms, and parse before you compare. Never test with a prefix match on the origin.
- **CWE-862, 639, missing authorization:** check ownership at the sink for every object id, including on lists, exports and background jobs. Being signed in is not being allowed.
- **CWE-384, 613, sessions and tokens:** store tokens hashed. Single-use tokens are spent atomically, a new one kills the old, and a password change ends other sessions. Answer identically whether an account exists or not.
- **CWE-208, comparing secrets:** compare in constant time and check lengths first, because some constant-time functions throw on a mismatch and that must not become a crash.
- **CWE-347, webhook signatures:** verify over the exact raw bytes, before parsing. Check the timestamp in both directions, accept rotated keys, and record a replay id only after verifying.
- **CWE-502, 1321, unsafe parsing:** never deserialize to code. Look up user-supplied keys with own-property checks, so `__proto__` and `constructor` are just missing names.
- **CWE-918, server-side request forgery:** an allowlist of hosts, resolved and checked after redirects, with internal ranges refused.
- **CWE-532, secrets in logs:** nothing secret in logs, errors or URLs.

If something is unclear, say so instead of guessing that it is safe.
