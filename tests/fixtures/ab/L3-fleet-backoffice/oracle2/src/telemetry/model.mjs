// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 200;
export const validTelemetry = (input) => Number.isInteger(input?.devices) && input.devices >= 1 && input.devices <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
