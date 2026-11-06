// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 90;
export const validRentals = (input) => Number.isInteger(input?.days) && input.days >= 1 && input.days <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
