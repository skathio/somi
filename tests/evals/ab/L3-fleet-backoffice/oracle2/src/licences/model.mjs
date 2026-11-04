// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 300;
export const validLicences = (input) => Number.isInteger(input?.drivers) && input.drivers >= 1 && input.drivers <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
