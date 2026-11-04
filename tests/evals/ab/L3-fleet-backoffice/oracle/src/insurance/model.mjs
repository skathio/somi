// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 300;
export const validInsurance = (input) => Number.isInteger(input?.vehicles) && input.vehicles >= 1 && input.vehicles <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
