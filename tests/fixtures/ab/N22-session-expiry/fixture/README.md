# Sessions

Times are milliseconds. A session is `{ id, userId, createdAt, expiresAt }`.

**How they behave.** A session ends after `sessionMinutes` of no activity, and each request counts as activity. Whatever happens, it ends `absoluteHours` after it was created. At its `expiresAt` it is already over. Requests come through `authenticate`, and the mobile app's background refresh comes through `renew`. `sweep` runs every minute and removes sessions that are over.
