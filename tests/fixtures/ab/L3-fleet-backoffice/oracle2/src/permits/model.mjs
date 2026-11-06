// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 50;
export const validPermits = (input) => Number.isInteger(input?.permits) && input.permits >= 1 && input.permits <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
