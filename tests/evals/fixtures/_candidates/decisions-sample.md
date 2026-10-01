## D1 — Audit-trail storage architecture

### Context

ADR 0004 (`docs/adr/0004-no-new-datastores.md`) requires a migration path off any new store.

### Decision

Partition the existing Postgres table by month.

### Alternatives considered

#### Option A — Partitioned Postgres — **Chosen**

- **Pros**: no new store
- **Cons**: partition maintenance is net-new operational surface for a two-person team
- **Reverses**: detach and merge partitions back; the down migration ships in the same PR

#### Option B — Object storage — Rejected

- **Pros**: cheap at a 7-year horizon
- **Cons**: a second durable store to page for
- **Reason for rejection**: migration path unproven
