# Coupons

`store.coupons` maps a code to `{ percent, expiresAt, maxTotal, maxPerUser }`. A redemption is `{ code, userId, orderId, at, cancelled }`. Codes are stored in the form `normCode` gives, and customers type them however they like.

## Rules

A coupon works up to and including its `expiresAt`. A cancelled order gives its redemption back, so cancelled redemptions count toward no limit, in `usageCount` and anywhere else. A coupon is used up at `maxTotal` redemptions, and one person cannot pass `maxPerUser`. Applying the same code to the same order again changes nothing and still works, because checkout retries.
