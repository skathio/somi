# Sales reports

An order's `at` is an ISO 8601 UTC timestamp. Reports count `{ at, amount }` orders.

## Business days

The shop lives in one time zone, named in `config.timeZone`. An order belongs to the calendar date on the shop's wall clock when it was placed, including across daylight saving changes. A month or a week is made of those dates. A period's `from` and `to` are dates and both are included.
