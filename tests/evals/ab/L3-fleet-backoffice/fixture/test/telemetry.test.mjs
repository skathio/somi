import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerTelemetry, voidTelemetry, telemetryTotal } from '../src/telemetry/service.mjs';
import { telemetryReport } from '../src/telemetry/report.mjs';

test('telemetry: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = registerTelemetry(store, { devices: 3, rate: 10 });
  assert.equal(entry.amount, 30);
  assert.equal(telemetryTotal(store), 30);
});

test('telemetry: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = registerTelemetry(store, { devices: 3, rate: 10 });
  voidTelemetry(store, entry.id);
  assert.equal(telemetryTotal(store), 0);
  assert.deepEqual(telemetryReport(store), []);
});

test('telemetry: too many devices is refused', () => {
  const store = createStore(1000);
  assert.throws(() => registerTelemetry(store, { devices: 201, rate: 10 }), RangeError);
});
