// Telemetry entries: what one is made of, and what makes one valid.
export const MAX_UNITS = 200;

export function makeTelemetryEntry(id, input, at) {
  if (!Number.isInteger(input.devices) || input.devices < 1 || input.devices > MAX_UNITS) throw new RangeError('devices must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');
  return { id, devices: input.devices, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const isTelemetryOpen = (entry) => !entry.voided;
export const isTelemetryLarge = (entry) => entry.devices > MAX_UNITS / 2;

export function describeTelemetry(entry) {
  const state = entry.voided ? 'void' : 'open';
  return `${entry.id}: ${entry.devices} devices at ${entry.rate} (${state})`;
}
