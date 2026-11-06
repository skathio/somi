import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveBio } from '../src/bio.mjs';

test('a short bio', () => assert.equal(saveBio({}, 'hi').bio, 'hi'));
