import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';

test('ids', () => assert.equal(createStore().nextId(), 'id1'));
