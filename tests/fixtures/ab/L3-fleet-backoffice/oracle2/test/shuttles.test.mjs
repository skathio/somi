// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordShuttles } from '../src/shuttles/service.mjs';
test('shuttles prices in cents', () => { assert.equal(recordShuttles(createStore(1), 't', { runs: 1, rate: 100 }).ok, true); });
