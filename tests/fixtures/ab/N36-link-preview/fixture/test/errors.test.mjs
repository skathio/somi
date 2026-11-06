import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/errors.mjs';

test('an error carries a code', () => assert.equal(new HttpError(400, 'x', 'y').code, 'x'));
