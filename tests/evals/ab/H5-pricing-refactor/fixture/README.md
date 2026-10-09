# Storefront pricing

The checkout calls `quote(cart)` from `src/pricing.mjs` and shows the answer to the customer. Run the tests with `npm test`.

## Conventions

- ES modules (`.mjs`), named exports only, no default exports, two-space indent, single quotes.
- Money is a plain number in the major unit of the cart's currency (`19.99`); yen have no minor unit. Amounts are never
  stored as cents.
- Invalid carts throw `PricingError`, which carries a stable `code` (`empty_cart`, `bad_item`, `unknown_currency`, ...)
  and a message. Nothing else is thrown on purpose.
- Pricing is a pure function of the cart: no clock, no I/O, no module state, and the cart it is given is never modified.
- Tests use `node:test` and live in `test/`, one `<module>.test.mjs` per module under `src/`.
- Finance signs off on the amounts this code produces, to the last digit. A change in any amount is a billing change,
  so a restructuring must not change one.

## `quote(cart)`

A cart is `{currency, customer: {country, tier, taxExempt}, items: [{sku, qty, unitPrice, category, weight}], coupons,
shipping: {method}, date}`. The answer is `{currency, lines, subtotal, discount, shipping, handling, tax, taxIncluded,
total, appliedCoupons, rejectedCoupons}`.

- Currencies: `USD`, `EUR`, `GBP`, `JPY`. Countries: `US`, `CA`, `DE`, `FR`, `GB`, `JP`. Categories: `general`, `book`,
  `food`, `digital`. Tiers: `standard`, `silver`, `gold`.
- Quantity discounts and member discounts come first, then coupons (at most three distinct known codes count), then
  shipping, then tax. In `US` and `CA` tax is added to the prices; in the other countries the prices already include it.
- Shipping depends on the country, the method (`standard`, `express`, `pickup`), the weight of the goods and what the
  order is worth after discounts. Small orders pay a handling fee.
- `couponCodes()` lists the coupon codes that exist.
