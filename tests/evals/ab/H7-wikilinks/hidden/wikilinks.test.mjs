// SOMI-CANARY-H7-3b8f60d2a1c479e5
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Every call renders in a fresh child process (the harness-owned runner), so the candidate never runs in this process.
const WS = process.env.TASK_WORKSPACE;
const RUNNER = fileURLToPath(new URL('./render.mjs', import.meta.url));
let hung = false; // once a call that uses double brackets times out, later such calls fail at once instead of waiting again
function render(md, { slow = false } = {}) {
  const wikiInput = md.includes('[[');
  assert.ok(!(wikiInput && hung), 'an earlier call timed out');
  const nonce = randomUUID();
  const r = spawnSync(process.execPath, [RUNNER, nonce], { cwd: WS, env: process.env, input: JSON.stringify({ md }), encoding: 'utf8', timeout: slow ? 4000 : 2000, killSignal: 'SIGKILL', maxBuffer: 16 << 20 });
  if (r.error) { if (wikiInput) hung = true; assert.fail('rendering did not finish: ' + r.error.code); }
  const m = new RegExp('\\nH7:' + nonce + ':(.*)\\n').exec(r.stdout ?? '');
  assert.ok(m, 'the renderer did not report');
  const reply = JSON.parse(m[1]);
  assert.ok(reply.html !== undefined, 'the renderer threw: ' + reply.error);
  return reply.html;
}

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const plain = (inner) => unescape(inner.replace(/<[^>]*>/g, ''));
function anchors(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[1].matchAll(/([A-Za-z][\w:-]*)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    return { whole: m[0], attrs, href: attrs.href ?? '', inner: m[2], text: plain(m[2]) };
  });
}
// The page a wiki link leads to: its address must be /wiki/ plus one plain-ASCII part that no URL parser can split.
function page(a) {
  assert.ok(a.href.startsWith('/wiki/'), 'href: ' + a.href);
  const rest = a.href.slice('/wiki/'.length);
  assert.ok(rest !== '' && !/[^\x21-\x7e]|["<>\/?#&\\]/.test(rest), 'unsafe address part: ' + rest);
  return decodeURIComponent(rest);
}
const tidy = (s) => s.replace(/\s+/g, ' ').trim();
function wiki(md, opts) { const html = render(md, opts); const a = anchors(html).filter((x) => x.href.startsWith('/wiki/')); return { html, a }; }
function one(md, opts) { const r = wiki(md, opts); assert.equal(r.a.length, 1, 'expected one wiki link in ' + r.html.slice(0, 300)); return { html: r.html, link: r.a[0] }; }
const without = (html, link) => html.replace(link.whole, '@');

const RESERVED = ['a/b', 'what? yes', 'C# notes', 'AT&T', 'x=1;y=2', 'a+b', 'a:b@c', 'back\\slash', 'Q&A / FAQ?'];
const PERCENT = ['100% real', '50%20 off', '%41', 'ends with %'];
const NON_LATIN = ['Zoë Müller', '日本 語', 'Ünï', 'emoji 😀 page', 'Ελληνικά'];
const MARKUP = ['Tom "T" Jones', "it's", '<b>x</b>', 'a<b>c', "5 > 3 & 2 < 4"];

test('AC1 [functional] a name in double brackets becomes a link showing the name and leading to that page under /wiki/', () => {
  const { html, link } = one('See [[Home]] now.');
  assert.equal(link.text, 'Home');
  assert.equal(page(link), 'Home');
  assert.equal(without(html, link), '<p>See @ now.</p>');
});
test('AC1 [functional] a name with several words works', () => { const { link } = one('[[Project Plan 2025]]'); assert.equal(link.text, 'Project Plan 2025'); assert.equal(page(link), 'Project Plan 2025'); });
test('AC1 [functional] several links in a paragraph and in later paragraphs are all links', () => {
  const { a } = wiki('[[A]] and [[B]], then [[C d]].\n\nLast: [[E]]');
  assert.deepEqual(a.map(page), ['A', 'B', 'C d', 'E']);
  assert.deepEqual(a.map((x) => x.text), ['A', 'B', 'C d', 'E']);
});
test('AC2 [functional] shown text replaces the name and the link still leads to the named page', () => { const { link } = one('[[Home|the start page]]'); assert.equal(tidy(link.text), 'the start page'); assert.equal(page(link), 'Home'); });
test('AC2 [functional] the address does not depend on the shown text', () => { assert.equal(one('[[Home|start]]').link.href, one('[[Home]]').link.href); });
test('AC2 [boundary] empty or blank shown text shows the name', () => { for (const md of ['[[Home|]]', '[[Home|   ]]']) { const { link } = one(md); assert.equal(tidy(link.text), 'Home', md); assert.equal(page(link), 'Home', md); } });
test('AC2 [boundary] spaces around the name and around the shown text do not count', () => { const { link } = one('[[ Home | start here ]]'); assert.equal(page(link), 'Home'); assert.equal(tidy(link.text), 'start here'); });
for (const [label, names] of [['reserved address characters', RESERVED], ['a percent sign', PERCENT], ['non-Latin letters', NON_LATIN], ['quotes, angle brackets and ampersands', MARKUP]]) {
  test(`AC4 [boundary] names with ${label} lead to a single address part that decodes to the name`, () => {
    for (const name of names) {
      const { link } = one(`See [[${name}]] here.`);
      assert.equal(page(link), name, name);
      assert.equal(link.text, name, name);
    }
  });
}
// README: "Addresses ... a character such as / ? # & % a quote or a space in it can never ... break out of the attribute."
test('AC4 [safety] a name cannot add attributes to the link or end it early', () => {
  const { html, link } = one('[[a" onmouseover="alert(1)" x="]]');
  assert.deepEqual(Object.keys(link.attrs).filter((k) => /^on/i.test(k)), []);
  assert.equal(page(link), 'a" onmouseover="alert(1)" x="');
  assert.equal(anchors(html).length, 1);
});
test('AC3 [boundary] a name may wrap onto the next line of a paragraph; it counts as one space', () => { const { link } = one('Read [[Long\nPage Name]] today'); assert.equal(tidy(link.text), 'Long Page Name'); assert.equal(page(link), 'Long Page Name'); });
test('AC3 [boundary] runs of spaces, tabs and line breaks in a name count as one space', () => { const { link } = one('[[  Many   spaces\t here \n again ]]'); assert.equal(tidy(link.text), 'Many spaces here again'); assert.equal(page(link), 'Many spaces here again'); });
test('AC3 [boundary] a blank line ends the paragraph, so a name cannot continue after it', () => {
  const { html, link } = one('[[Long\n\nName]] and [[Ok]]');
  assert.equal(page(link), 'Ok');
  assert.ok(html.includes('[[Long') && html.includes('Name]]'), html);
});
test('AC3 [boundary] a name that is only whitespace is not a link and stays as typed', () => { const { html, link } = one('[[   ]] then [[Ok]]'); assert.equal(page(link), 'Ok'); assert.equal(without(html, link), '<p>[[   ]] then @</p>'); });
// README: "Escaping ... `a & b` is already `a &amp; b` when a rule sees it. Output built from a rule's captured text must not be escaped a second time."
test('AC4 [safety] an ampersand in a name or shown text is escaped once, in the text and in the address', () => {
  const { html, link } = one('[[A & B]]');
  assert.equal(link.text, 'A & B');
  assert.equal(page(link), 'A & B');
  assert.ok(link.inner.includes('A &amp; B') && !html.includes('&amp;amp;') && !/%26amp/i.test(html), html);
  assert.equal(plain(one('[[x|C & D]]').link.inner), 'C & D');
});
// README: "Raw HTML never passes through" (Escaping).
test('AC4 [safety] markup typed in a name or in shown text is shown as text, never as html', () => {
  for (const md of ['[[<script>alert(1)</script>]]', '[[x|<img src=x onerror=alert(1)>]]', '[[x|a <b>bold</b> claim]]']) {
    const { html, link } = one(md);
    assert.ok(!/<(script|img|b)[\s>]/i.test(html), html);
    assert.ok(link.inner.includes('&lt;'), html);
  }
  assert.equal(one('[[<script>alert(1)</script>]]').link.text, '<script>alert(1)</script>');
});
// README: "The whole input is HTML-escaped once, up front (`& < > \" '`)" (Escaping).
test('AC4 [safety] quotes in shown text are escaped like everywhere else', () => {
  const { link } = one(`[[x|say "hi" & 'bye']]`);
  assert.equal(link.inner, 'say &quot;hi&quot; &amp; &#39;bye&#39;');
});
// README: "Code is literal."
test('AC6 [functional] double brackets in a code span stay as typed; a real link beside it is a link', () => {
  const { html, link } = one('`[[Home]]` and [[Real]]');
  assert.equal(page(link), 'Real');
  assert.ok(html.includes('<code>[[Home]]</code>'), html);
});
test('AC6 [functional] double brackets in a fenced block stay as typed', () => {
  const { html, link } = one('```\n[[Home|x]]\n```\n\n[[Real]]');
  assert.equal(page(link), 'Real');
  assert.ok(html.includes('<pre><code>[[Home|x]]</code></pre>'), html);
});
test('AC6 [boundary] code spans on either side of a link and a code span cut through brackets are all left alone', () => {
  const a = one('`a` [[B]] `c`');
  assert.equal(page(a.link), 'B');
  assert.equal(without(a.html, a.link), '<p><code>a</code> @ <code>c</code></p>');
  const b = one('`[[` Home `]]` and [[Real]]');
  assert.equal(page(b.link), 'Real');
  assert.ok(b.html.includes('<code>[[</code> Home <code>]]</code>'), b.html);
});
test('AC6 [functional] the shown text may contain code, which stays code', () => { const { link } = one('[[Home|run `ls -l` now]]'); assert.ok(link.inner.includes('<code>ls -l</code>'), link.inner); assert.equal(page(link), 'Home'); });
test('AC5 [functional] shown text is formatted like the text of an ordinary link', () => { const { link } = one('[[Home|**big** and *small*]]'); assert.ok(link.inner.includes('<strong>big</strong>') && link.inner.includes('<em>small</em>'), link.inner); assert.equal(page(link), 'Home'); });
test('AC5 [functional] emphasis can wrap a wiki link', () => {
  assert.match(one('**[[Home]]**').html, /^<p><strong><a [^>]*>Home<\/a><\/strong><\/p>$/);
  assert.match(one('*see [[Home]] now*').html, /^<p><em>see <a [^>]*>Home<\/a> now<\/em><\/p>$/);
});
// README: "Finished pieces are parked ... so that later rules cannot change it" and "Emphasis ... the markers inside a link's target or text are not emphasis for the surrounding text."
test('AC5 [boundary] emphasis characters in a name are part of the name, in the text and in the address', () => {
  for (const name of ['snake_case_name', '__init__', '2*3*4', '*starred*']) {
    const { html, link } = one(`[[${name}]]`);
    assert.equal(link.text, name, name);
    assert.equal(page(link), name, name);
    assert.ok(!/<(em|strong)>/.test(html), name + ' ' + html);
  }
});
// README: "Finished pieces are parked" (see above).
test('AC5 [boundary] two names with emphasis characters in one paragraph do not pair up into emphasis', () => {
  const { html, a } = wiki('[[a*b]] and [[c*d]] but [[e_f]] and [[g_h]]');
  assert.deepEqual(a.map((x) => x.text), ['a*b', 'c*d', 'e_f', 'g_h']);
  assert.ok(!/<(em|strong)>/.test(html), html);
});
test('AC5 [functional] ordinary links on the same line keep working and are not touched', () => {
  const a = anchors(render('[docs](https://example.com/a_b_c?x=1&y=2) and [[Home]] and [here](/x)'));
  assert.equal(a.length, 3);
  assert.equal(a[0].href, 'https://example.com/a_b_c?x=1&amp;y=2');
  assert.equal(a[0].attrs.rel, 'noopener');
  assert.equal(page(a[1]), 'Home');
  assert.equal(a[2].href, '/x');
});
test('AC5 [functional] links next to each other are separate links', () => { assert.deepEqual(wiki('[[A]][[B]], [[C]]').a.map(page), ['A', 'B', 'C']); });
// README: "Brackets never nest ... An opening bracket that is never closed is just text." and "Failure ... shown as typed".
test('AC7 [boundary] unclosed double brackets stay as typed and a later link still works', () => {
  const { html, link } = one('[[oops and [[Good]]');
  assert.equal(page(link), 'Good');
  assert.equal(without(html, link), '<p>[[oops and @</p>');
});
test('AC7 [boundary] a stray closing pair and a trailing bracket stay as typed', () => { const { html, link } = one('Page]] then [[Good]]]'); assert.equal(page(link), 'Good'); assert.equal(without(html, link), '<p>Page]] then @]</p>'); });
test('AC7 [boundary] an empty name is not a link, with or without shown text', () => { const { html, link } = one('[[]] [[|x]] [[Ok]]'); assert.equal(page(link), 'Ok'); assert.equal(without(html, link), '<p>[[]] [[|x]] @</p>'); });
// README: "Brackets never nest. The text of a construct cannot contain [ or ]."
test('AC7 [boundary] a name with a single bracket in it is not a link', () => { const { html, link } = one('[[a [b]] and [[c] and [[Ok]]'); assert.equal(page(link), 'Ok'); assert.equal(without(html, link), '<p>[[a [b]] and [[c] and @</p>'); });
// README: "Failure ... The renderer never throws, whatever text it is given (lone surrogates and control characters included)."
test('AC7 [safety] text that cannot be written in an address does not make the renderer fail', () => {
  const { html, a } = wiki('[[bad \uD800 name]] and [[Fine]]');
  assert.ok(a.some((x) => x.href === '/wiki/Fine'), html);
  assert.ok(html.includes('bad') && html.includes('name'), html);
});
// README: "Size ... a 200 KB document renders in well under a second, so no rule may take more than linear time on long runs of unclosed or repeated markers."
test('AC7 [boundary] very long runs of unclosed brackets are rendered quickly', () => {
  for (const md of ['[[a '.repeat(40000), '[['.repeat(60000), '[[x|'.repeat(40000), '[[' + 'word '.repeat(40000)]) {
    const { link } = one(md + ' [[Ok]]', { slow: true });
    assert.equal(page(link), 'Ok');
  }
});
test('AC5 [functional] wiki links work in headings', () => { assert.match(one('## About [[Home|us]]').html, /^<h2>About <a [^>]*>us<\/a><\/h2>$/); });
test('AC5 [functional] wiki links work in list items', () => {
  const { html, a } = wiki('- see [[Home|home]]\n- [[Other page]] too');
  assert.deepEqual(a.map(page), ['Home', 'Other page']);
  assert.match(html, /^<ul>\n<li>see <a [^>]*>home<\/a><\/li>\n<li><a [^>]*>Other page<\/a> too<\/li>\n<\/ul>$/);
});
test('AC8 [regression] paragraphs keep soft line breaks and headings and lists keep their shape', () => {
  assert.equal(render('one\ntwo\n\nthree'), '<p>one\ntwo</p>\n<p>three</p>');
  assert.equal(render('## A *big* day'), '<h2>A <em>big</em> day</h2>');
  assert.equal(render('- a\n- **b**'), '<ul>\n<li>a</li>\n<li><strong>b</strong></li>\n</ul>');
  assert.equal(render('a\r\nb\r\n\r\nc'), '<p>a\nb</p>\n<p>c</p>');
});
test('AC8 [regression] text is escaped once and raw html never passes through', () => { assert.equal(render('a < b & <i>c</i> "q" \'s\''), '<p>a &lt; b &amp; &lt;i&gt;c&lt;/i&gt; &quot;q&quot; &#39;s&#39;</p>'); });
test('AC8 [regression] emphasis needs markers that hug the text, and wraps links', () => {
  assert.equal(render('2 * 3 * 4 and *five* and __six__'), '<p>2 * 3 * 4 and <em>five</em> and <strong>six</strong></p>');
  assert.equal(render('*see [a](/x_y_z) now*'), '<p><em>see <a href="/x_y_z">a</a> now</em></p>');
});
test('AC8 [regression] code spans and fenced blocks are literal and escaped', () => {
  assert.equal(render('use `*a* <b>` now'), '<p>use <code>*a* &lt;b&gt;</code> now</p>');
  assert.equal(render('```js\nlet a = "<x>";\n```'), '<pre><code class="language-js">let a = &quot;&lt;x&gt;&quot;;</code></pre>');
});
test('AC8 [regression] ordinary links: rel=noopener on other sites, none on this one, and unsafe targets lose the link', () => {
  assert.equal(render('[the *docs*](https://example.com/a?x=1&y=2)'), '<p><a href="https://example.com/a?x=1&amp;y=2" rel="noopener">the <em>docs</em></a></p>');
  assert.equal(render('[home](/index) [bad](javascript:alert)'), '<p><a href="/index">home</a> bad</p>');
});
test('AC8 [regression] code in the text of an ordinary link stays code', () => { assert.equal(render('[run `ls -l`](/x)'), '<p><a href="/x">run <code>ls -l</code></a></p>'); });
test('AC8 [regression] single square brackets and brackets around a link stay as before', () => { assert.equal(render('[x] and [y] and [z](/z)'), '<p>[x] and [y] and <a href="/z">z</a></p>'); });
test('AC9 [boundary] the README documents wiki links', () => { assert.ok(readFileSync(WS + '/README.md', 'utf8').includes('[[')); });
function testFiles(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? testFiles(dir + '/' + e.name) : e.name.endsWith('.test.mjs') ? [dir + '/' + e.name] : [])); }
test('AC9 [boundary] the new behaviour has tests in test/ (any test file there that uses double brackets)', () => { assert.ok(testFiles(WS + '/test').some((f) => { const src = readFileSync(f, 'utf8'); return src.includes('[[') && /\b(test|it)\(/.test(src); })); });
