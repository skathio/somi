// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 150;
export const validConsumables = (input) => Number.isInteger(input?.boxes) && input.boxes >= 1 && input.boxes <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
