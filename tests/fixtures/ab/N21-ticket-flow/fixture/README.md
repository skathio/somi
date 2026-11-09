# Tickets

`transition(ticket, action, user, now)` changes a ticket and returns the events to send. A ticket is `{ id, status, assignee, updatedAt }`, and a user is `{ id, admin }`. `HttpError` is in `src/errors.mjs`.
