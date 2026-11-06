// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 24;
export const validGlass = (input) => Number.isInteger(input?.panes) && input.panes >= 1 && input.panes <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
