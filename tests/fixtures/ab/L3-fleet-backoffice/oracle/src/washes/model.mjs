// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 200;
export const validWashes = (input) => Number.isInteger(input?.washes) && input.washes >= 1 && input.washes <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
