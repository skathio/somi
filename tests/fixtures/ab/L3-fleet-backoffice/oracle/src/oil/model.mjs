// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 900;
export const validOil = (input) => Number.isInteger(input?.litres) && input.litres >= 1 && input.litres <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
