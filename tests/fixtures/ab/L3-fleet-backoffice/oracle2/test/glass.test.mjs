// SOMI-CANARY-L3-5d1e7ac94b02f863
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { recordGlass } from '../src/glass/service.mjs';
test('glass prices in cents', () => { assert.equal(recordGlass(createStore(1), 't', { panes: 1, rate: 100 }).ok, true); });
