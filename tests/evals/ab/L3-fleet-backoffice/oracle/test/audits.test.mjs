// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { logAudits } from '../src/audits/service.mjs';
test('audits prices in cents', () => { assert.equal(logAudits(createStore(1), 't', { sites: 1, rate: 100 }).ok, true); });
