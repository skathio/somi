// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 400;
export const validStorage = (input) => Number.isInteger(input?.pallets) && input.pallets >= 1 && input.pallets <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
