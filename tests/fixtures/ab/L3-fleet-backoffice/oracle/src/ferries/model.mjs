// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 150;
export const validFerries = (input) => Number.isInteger(input?.sailings) && input.sailings >= 1 && input.sailings <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
