// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 70;
export const validBatteries = (input) => Number.isInteger(input?.packs) && input.packs >= 1 && input.packs <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
