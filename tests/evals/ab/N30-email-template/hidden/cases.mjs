// SOMI-CANARY-N30-651ed5c0515043fe
const H = (t, d, o) => async (l) => (await l('src/template.mjs')).renderHtml(t, d, o);
const decoded = (t, d, o) => async (l) => (await l('src/template.mjs')).renderHtml(t, d, o).replaceAll('&#x27;', '&#39;');
export const cases = [
  { name: 'AC1 [functional] it fills in like the text renderer', run: H('Hi {{ name }}, {{a.b}}!', { name: 'Ann', a: { b: 2 } }), expect: 'Hi Ann, 2!' },
  { name: 'AC1 [safety] markup in a value is escaped', run: H('<p>{{n}}</p>', { n: '<script>x</script>' }), expect: '<p>&lt;script&gt;x&lt;/script&gt;</p>' },
  { name: 'AC1 [boundary] an ampersand is escaped once', run: H('{{n}}', { n: 'A&B &amp; C' }), expect: 'A&amp;B &amp;amp; C' },
  { name: 'AC1 [safety] [unprompted] quotes are escaped so a value cannot leave an attribute', run: decoded('<a title="{{n}}">', { n: `x" onclick="y' ` }), expect: '<a title="x&quot; onclick=&quot;y&#39; ">' },
  { name: 'AC1 [boundary] the template itself is not escaped', run: H('<b>&nbsp;{{n}}</b>', { n: 'x' }), expect: '<b>&nbsp;x</b>' },
  { name: 'AC1 [functional] nothing behind a name is empty', run: H('[{{a}}][{{b.c}}][{{d}}]', { d: null }), expect: '[][][]' },
  { name: 'AC1 [boundary] zero and false show', run: H('{{a}} {{b}}', { a: 0, b: false }), expect: '0 false' },
  { name: 'AC1 [safety] [unprompted] object internals are not reachable', run: H('[{{constructor}}][{{__proto__.x}}][{{toString}}][{{a.constructor.name}}]', { a: {} }), expect: '[][][][]' },
  { name: 'AC1 [safety] [unprompted] a whole object does not print', run: H('[{{a}}][{{b}}]', { a: { x: 1 }, b: [1] }), expect: '[][]' },
  { name: 'AC1 [safety] [unprompted] a value is not filled in again', run: H('{{a}}', { a: '{{b}}', b: 'secret' }), expect: '{{b}}' },
  { name: 'AC1 [safety] [unprompted] a value with a replacement pattern stays literal', run: decoded('{{a}}', { a: "$& $1 $'" }), expect: '$&amp; $1 $&#39;' },
  { name: 'AC2 [functional] a trusted name goes in unescaped', run: H('{{{body}}}', { body: '<b>x</b>' }, { trusted: ['body'] }), expect: '<b>x</b>' },
  { name: 'AC2 [safety] a triple brace on any other name is escaped', run: H('{{{n}}}', { n: '<b>' }, { trusted: ['body'] }), expect: '&lt;b&gt;' },
  { name: 'AC2 [safety] no options means nothing is trusted', run: H('{{{n}}}', { n: '<b>' }), expect: '&lt;b&gt;' },
  { name: 'AC2 [safety] double braces escape even a trusted name', run: H('{{body}}', { body: '<b>' }, { trusted: ['body'] }), expect: '&lt;b&gt;' },
  { name: 'AC2 [safety] [unprompted] a trusted nested path must be named in full', run: H('{{{a.b}}}', { a: { b: '<i>' } }, { trusted: ['a'] }), expect: '&lt;i&gt;' },
  { name: 'AC3 [regression] plain text is not escaped', run: async (l) => (await l('src/template.mjs')).renderText('{{n}}', { n: '<A&B>' }), expect: '<A&B>' },
  { name: 'AC3 [regression] plain text keeps its reach into data', run: async (l) => (await l('src/template.mjs')).renderText('{{a.length}}', { a: 'xyz' }), expect: '' },
];
