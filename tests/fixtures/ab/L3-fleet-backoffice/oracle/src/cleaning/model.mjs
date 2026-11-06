// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 80;
export const validCleaning = (input) => Number.isInteger(input?.cabins) && input.cabins >= 1 && input.cabins <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
