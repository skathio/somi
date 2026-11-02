# Data retention policy

**Closing an account does not erase the row.** Set `closedAt` to the time of closing and keep the row and its id, so that invoices keep pointing at something. Finance must keep invoices for seven years, untouched.

**Personal data goes at once.** On closing, `email` becomes `closed-<id>@invalid`, and `name` and `phone` become null.

**Access ends at once.** A closed account has no live sessions and cannot sign in. It no longer appears in lists of users, and looking it up by email finds nothing. Looking it up by id still works, for finance.

**An address can come back.** Someone may register again with an email that once belonged to a closed account.

Every closing is recorded as an audit entry with `type: "account.closed"`, the `userId` and `at`.
