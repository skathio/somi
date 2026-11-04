// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 40;
export const validTires = (input) => Number.isInteger(input?.tires) && input.tires >= 1 && input.tires <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
