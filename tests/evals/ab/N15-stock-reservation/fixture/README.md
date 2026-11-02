# Shop stock

`store.stock` maps a sku to units on the shelf. `checkout(store, { sku, qty }, options)` takes units off the shelf; `options.now` is the time. `stockReport(store, now)` is what the warehouse screen shows.

A reservation is live until its `expiresAt`, and at that very moment it no longer holds anything.
