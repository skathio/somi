// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 160;
export const validRepairs = (input) => Number.isInteger(input?.hours) && input.hours >= 1 && input.hours <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
