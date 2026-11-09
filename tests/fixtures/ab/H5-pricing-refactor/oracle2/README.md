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

## Layout of `src/`

`pricing.mjs` is the entry point (`quote`, `PricingError`, `SUPPORTED_CURRENCIES`, `couponCodes`) and only runs the steps.

| Module | Owns |
| --- | --- |
| `rounding.mjs` | every rounding of an amount, in its two flavours |
| `discounts.mjs` | quantity and member discounts, coupon choice and application |
| `shipping.mjs` | the shipping charge and the handling fee |
| `tax.mjs` | tax, included in the price or added on top |
| `cart.mjs`, `tables.mjs`, `errors.mjs` | cart checks and working lines, rate cards and coupon tables, `PricingError` |

<!-- SOMI-CANARY-H5-6c2e9a41d7b3f085 -->
