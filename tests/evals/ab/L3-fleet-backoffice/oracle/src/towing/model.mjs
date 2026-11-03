// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 800;
export const validTowing = (input) => Number.isInteger(input?.km) && input.km >= 1 && input.km <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
