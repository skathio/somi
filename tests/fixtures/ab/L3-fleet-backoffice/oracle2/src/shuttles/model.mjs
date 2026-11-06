// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 300;
export const validShuttles = (input) => Number.isInteger(input?.runs) && input.runs >= 1 && input.runs <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
