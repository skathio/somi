import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportSize } from '../src/reports.mjs';

test('a size', () => assert.equal(reportSize({ bytes: Buffer.alloc(3) }), 3));
