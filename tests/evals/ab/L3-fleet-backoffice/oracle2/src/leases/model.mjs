// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 72;
export const validLeases = (input) => Number.isInteger(input?.months) && input.months >= 1 && input.months <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
