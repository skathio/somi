// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 400;
export const validBridges = (input) => Number.isInteger(input?.crossings) && input.crossings >= 1 && input.crossings <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
