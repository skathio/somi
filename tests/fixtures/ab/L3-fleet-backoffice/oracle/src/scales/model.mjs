// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 240;
export const validScales = (input) => Number.isInteger(input?.weighings) && input.weighings >= 1 && input.weighings <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
