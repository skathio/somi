// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 30;
export const validFines = (input) => Number.isInteger(input?.points) && input.points >= 1 && input.points <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
