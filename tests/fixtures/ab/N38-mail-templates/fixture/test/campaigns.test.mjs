import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subjectLine } from '../src/campaigns.mjs';

test('a subject is trimmed', () => assert.equal(subjectLine({ subject: ' Hi ' }), 'Hi'));
