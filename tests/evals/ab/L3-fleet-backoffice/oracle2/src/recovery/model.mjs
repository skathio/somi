// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 30;
export const validRecovery = (input) => Number.isInteger(input?.callouts) && input.callouts >= 1 && input.callouts <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
