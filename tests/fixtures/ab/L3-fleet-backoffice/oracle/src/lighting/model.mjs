// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 110;
export const validLighting = (input) => Number.isInteger(input?.lamps) && input.lamps >= 1 && input.lamps <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
