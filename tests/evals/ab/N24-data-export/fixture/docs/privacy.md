# Privacy promises

**Who.** A person can ask for their own data. An admin can ask for anyone's. Anyone else gets `HttpError(403, 'forbidden')`.

**What.** The export is `{ profile, orders, tickets, exportedAt }`. It holds only that person's orders and tickets. Orders and tickets keep their own fields, in creation order, except what follows.

**What never leaves.** The password hash and our internal staff notes on a profile. On a ticket, the name of the agent who handled it (`assignee`) and any `internal` field.

**How often.** A person can export once every 24 hours, and a second try within that time gets `HttpError(429, 'too_many_exports')`. An admin is not limited and an admin's export does not use up the person's allowance.

**Record.** Every export writes `{ type: 'data.exported', userId, by, at }` to the audit log.
