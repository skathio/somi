# Month-end totals

`regionTotals(rows, fetchRate)` adds up `{ region, currency, cents }` rows in US cents, using an async `fetchRate(currency)`. `topRegions(summary, n)` ranks a summary, biggest first, and regions that tie come in name order. Reports share the same `summary` list between screens.
