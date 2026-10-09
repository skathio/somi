// SOMI-CANARY-H7-3b8f60d2a1c479e5
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/index.mjs';

const hrefOf = (html) => /href="([^"]*)"/.exec(html)[1];

test('a wiki link shows the page name and leads to its address', () => {
  const html = render('See [[Home]] now.');
  assert.equal(html, '<p>See <a href="/wiki/Home">Home</a> now.</p>');
});

test('shown text replaces the name, and only the first bar separates', () => {
  assert.equal(render('[[Home|the *start* page|really]]'), '<p><a href="/wiki/Home">the <em>start</em> page|really</a></p>');
  assert.equal(render('[[Home|  ]]'), '<p><a href="/wiki/Home">Home</a></p>');
});

test('names are one address part, decoded to the typed name', () => {
  const html = render('[[AT&T / R&D? #1 100%]]');
  assert.equal(hrefOf(html), '/wiki/AT%26T%20%2F%20R%26D%3F%20%231%20100%25');
  assert.ok(html.includes('>AT&amp;T / R&amp;D? #1 100%</a>'));
});

test('whitespace in a name is tidied, also across a line break', () => {
  assert.equal(render('[[  Long\n  Page\tName ]]'), '<p><a href="/wiki/Long%20Page%20Name">Long Page Name</a></p>');
});

test('code is never interpreted', () => {
  assert.equal(render('`[[Home]]`'), '<p><code>[[Home]]</code></p>');
  assert.equal(render('```\n[[Home]]\n```'), '<pre><code>[[Home]]</code></pre>');
});

test('emphasis characters in a name are part of the name', () => {
  assert.equal(render('**[[a_b_c]]** and [[2*3*4]]'), '<p><strong><a href="/wiki/a_b_c">a_b_c</a></strong> and <a href="/wiki/2*3*4">2*3*4</a></p>');
});

test('brackets that do not form a link stay as typed, and the next link still works', () => {
  assert.equal(render('[[oops and [[Good]] ]] [[]] [[|x]] [[a [b]]'), '<p>[[oops and <a href="/wiki/Good">Good</a> ]] [[]] [[|x]] [[a [b]]</p>');
  assert.ok(render('[[bad \uD800 name]] [[Fine]]').includes('<a href="/wiki/Fine">'));
});
