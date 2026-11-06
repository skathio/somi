// SOMI-CANARY-H7-3b8f60d2a1c479e5
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/index.mjs';

test('[[Page]] and [[Page|text]] become links under /wiki/', () => {
  assert.equal(render('[[Home]] [[Home|start]]'), '<p><a href="/wiki/Home">Home</a> <a href="/wiki/Home">start</a></p>');
});

test('names are percent-encoded and shown as typed', () => {
  assert.equal(render('[[R&D / Q?]]'), '<p><a href="/wiki/R%26D%20%2F%20Q%3F">R&amp;D / Q?</a></p>');
});

test('malformed brackets stay as typed and code is left alone', () => {
  assert.equal(render('[[a [[B]] `[[c]]`'), '<p>[[a <a href="/wiki/B">B</a> <code>[[c]]</code></p>');
});
