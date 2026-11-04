// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 90;
export const validTraining = (input) => Number.isInteger(input?.seats) && input.seats >= 1 && input.seats <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
