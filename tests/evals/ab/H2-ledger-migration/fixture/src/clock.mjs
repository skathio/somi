// Timestamps are ISO-8601 in UTC with whole seconds: YYYY-MM-DDTHH:MM:SSZ.
export const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
