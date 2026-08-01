# ADR 0004 — No new datastores without a migration path

> Status: `accepted` • Date: 2026-02-11

## Context

We run one Postgres instance. The team is two people. Every additional datastore is a second thing
to back up, monitor, patch, and be paged for.

## Decision

We do not add a datastore without a **migration path off it**. A proposal for a new store must say
how we would move the data back out, and roughly what that would cost, before it is accepted.

## Consequences

Adding a store is slower. Leaving one is possible.
