// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 600;
export const validChargers = (input) => Number.isInteger(input?.sessions) && input.sessions >= 1 && input.sessions <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
