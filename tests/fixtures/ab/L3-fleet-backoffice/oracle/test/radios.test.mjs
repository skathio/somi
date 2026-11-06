// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { addRadios } from '../src/radios/service.mjs';
test('radios prices in cents', () => { assert.equal(addRadios(createStore(1), 't', { units: 1, rate: 100 }).ok, true); });
