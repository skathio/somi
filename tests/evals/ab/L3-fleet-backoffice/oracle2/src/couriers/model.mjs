// SOMI-CANARY-L3-5d1e7ac94b02f863
export const MAX_UNITS = 900;
export const validCouriers = (input) => Number.isInteger(input?.parcels) && input.parcels >= 1 && input.parcels <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;
