import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../src/index.mjs';

test('paragraphs are separated by blank lines and keep their soft line breaks', () => {
  assert.equal(render('one\ntwo\n\nthree'), '<p>one\ntwo</p>\n<p>three</p>');
});

test('headings take their level from the hashes and are formatted like text', () => {
  assert.equal(render('## A *big* day'), '<h2>A <em>big</em> day</h2>');
});

test('bullet items become one list', () => {
  assert.equal(render('- a\n- **b**'), '<ul>\n<li>a</li>\n<li><strong>b</strong></li>\n</ul>');
});

test('text is escaped before anything else happens, and raw html never passes through', () => {
  assert.equal(render('a < b & <i>c</i> "q"'), '<p>a &lt; b &amp; &lt;i&gt;c&lt;/i&gt; &quot;q&quot;</p>');
});

test('emphasis markers must hug the text', () => {
  assert.equal(render('2 * 3 * 4 and *five*'), '<p>2 * 3 * 4 and <em>five</em></p>');
});

test('code spans and fenced blocks are shown literally, escaped', () => {
  assert.equal(render('use `*a* <b>` now'), '<p>use <code>*a* &lt;b&gt;</code> now</p>');
  assert.equal(render('```js\nlet a = "<x>";\n```'), '<pre><code class="language-js">let a = &quot;&lt;x&gt;&quot;;</code></pre>');
});

test('links: external ones get rel=noopener, targets that are not http(s), mailto, / or # lose the link', () => {
  assert.equal(render('[the *docs*](https://example.com/a?x=1&y=2)'), '<p><a href="https://example.com/a?x=1&amp;y=2" rel="noopener">the <em>docs</em></a></p>');
  assert.equal(render('[home](/index)'), '<p><a href="/index">home</a></p>');
  assert.equal(render('[bad](javascript:alert)'), '<p>bad</p>');
});

test('emphasis around a link works, and emphasis markers inside a link target are left alone', () => {
  assert.equal(render('*see [a](/x_y_z) now*'), '<p><em>see <a href="/x_y_z">a</a> now</em></p>');
});

test('brackets never nest and an unclosed bracket is just text', () => {
  assert.equal(render('[a [b](/x) and [c'), '<p>[a <a href="/x">b</a> and [c</p>');
});

test('odd text never throws and a large document renders quickly', () => {
  assert.equal(render('a \uD800 b \u0001'), '<p>a \uD800 b \u0001</p>');
  const start = Date.now();
  render('[a '.repeat(40000) + '*x* '.repeat(20000) + '`'.repeat(20000));
  assert.ok(Date.now() - start < 1000);
});

test('Windows line endings are treated as line breaks', () => {
  assert.equal(render('a\r\nb\r\n\r\nc'), '<p>a\nb</p>\n<p>c</p>');
});
