// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 20;
export const validAudits = (input) => Number.isInteger(input?.sites) && input.sites >= 1 && input.sites <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
