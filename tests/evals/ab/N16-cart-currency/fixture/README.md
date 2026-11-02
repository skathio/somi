# Money

Amounts are whole minor units of their currency (cents, or whole yen). `src/currency.mjs` says how many decimals each currency has.

## Converting a cart

Each line is converted on its own into the target currency and rounded to a whole minor unit, with halves going away from zero, because a discount line is negative. The total is the sum of those rounded lines.
