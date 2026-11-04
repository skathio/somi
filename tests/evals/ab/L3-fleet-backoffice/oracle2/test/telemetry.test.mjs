// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { registerTelemetry } from '../src/telemetry/service.mjs';
test('telemetry prices in cents', () => { assert.equal(registerTelemetry(createStore(1), 't', { devices: 1, rate: 100 }).ok, true); });
