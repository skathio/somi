// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 120;
export const validUniforms = (input) => Number.isInteger(input?.sets) && input.sets >= 1 && input.sets <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
