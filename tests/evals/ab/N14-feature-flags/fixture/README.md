# Feature flags

A flag is `{ name, enabled }`, read through `src/cache.mjs` because flags are read on every request. Every change to a flag appends `{ type: 'flag.changed', name, actor, at }` to `store.audit`. An unknown flag is off.

## Rollout rules, in order

1. A user in `deny` is off. 2. A user in `allow` is on. 3. If `enabled` is false, the flag is off. 4. With no `percent`, it is on. 5. Otherwise the user's bucket decides: on if the bucket is below `percent`.

A user's bucket is the first four bytes of the SHA-256 of `<flag name>:<user id>`, read as a big-endian unsigned number, modulo 100. So a user keeps their answer as a percent grows, and two flags do not pick the same users.
