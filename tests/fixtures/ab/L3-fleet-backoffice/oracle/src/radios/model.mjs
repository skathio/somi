// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 120;
export const validRadios = (input) => Number.isInteger(input?.units) && input.units >= 1 && input.units <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
