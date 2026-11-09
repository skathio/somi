// SOMI-CANARY-N38-870c1422ee704ede
const r = (t, v) => async (l) => (await l('src/templates.mjs')).render(t, v);
const html = (t, v) => async (l) => (await r(t, v)(l)).html;
const unquote = (s) => s.replaceAll('&#39;', "'").replaceAll('&#x27;', "'").replaceAll('&apos;', "'").replaceAll('&quot;', '"').replaceAll('&#34;', '"').replaceAll('&#x22;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
export const cases = [
  { name: 'AC2 [functional] a placeholder is filled, with or without spaces', run: html('Hi {{name}} and {{ name }}!', { name: 'Ann' }), expect: 'Hi Ann and Ann!' },
  { name: 'AC2 [functional] a dotted path goes through nested objects', run: html('{{user.address.city}}', { user: { address: { city: 'Oslo' } } }), expect: 'Oslo' },
  { name: 'AC2 [boundary] the template\'s own markup is left alone', run: html('<a href="x">{{n}} & co</a>', { n: 'A' }), expect: '<a href="x">A & co</a>' },
  { name: 'AC3 [functional] a missing value renders as nothing, and is listed once in order', run: r('{{b}}x{{a}}y{{b}}', {}), expect: { html: 'xy', missing: ['b', 'a'] } },
  { name: 'AC3 [boundary] zero and false are values', run: r('{{z}} {{f}}', { z: 0, f: false }), expect: { html: '0 false', missing: [] } },
  { name: 'AC3 [boundary] an empty string is a value, and null is not', run: r('[{{e}}][{{n}}]', { e: '', n: null }), expect: { html: '[][]', missing: ['n'] } },
  { name: 'AC3 [boundary] a path through something missing counts as missing', run: r('{{a.b.c}}', { a: {} }), expect: { html: '', missing: ['a.b.c'] } },
  { name: 'AC2 [safety] a customer value cannot add markup', run: html('{{n}}', { n: '<img src=x onerror=alert(1)>&' }), expect: '&lt;img src=x onerror=alert(1)&gt;&amp;' },
  { name: 'AC2 [safety] a customer value cannot break out of an attribute', run: async (l) => { const out = await html('<a title="{{n}}" alt=\'{{n}}\'>', { n: `"' x="` })(l); return [/^<a title="[^"']*" alt='[^"']*'>$/.test(out), unquote(out.slice(10, out.indexOf('" alt')))]; }, expect: [true, `"' x="`] },
  { name: 'AC2 [safety] a value that looks like a placeholder is not filled in again', run: r('{{a}}{{b}}', { a: '{{b}}', b: 'secret' }), expect: { html: '{{b}}secret', missing: [] } },
  { name: 'AC2 [safety] replacement patterns in a value stay literal', run: async (l) => unquote(await html('a{{n}}b', { n: "$& $1 $` $' $$" })(l)), expect: "a$& $1 $` $' $$b" },
  { name: 'AC2 [safety] [unprompted] names built into every object are not values', run: r('[{{constructor}}][{{toString}}][{{__proto__}}]', { a: 1 }), expect: { html: '[][][]', missing: ['constructor', 'toString', '__proto__'] } },
  { name: 'AC2 [safety] [unprompted] a path cannot climb through built-in names', run: r('[{{user.constructor.name}}][{{user.__proto__.polluted}}]', { user: { name: 'A' } }), expect: { html: '[][]', missing: ['user.constructor.name', 'user.__proto__.polluted'] } },
  { name: 'AC2 [boundary] a customer key named like a built-in works', run: async (l) => (await html('{{constructor}}', JSON.parse('{"constructor":"Acme"}'))(l)), expect: 'Acme' },
  { name: 'AC4 [functional] an escaped placeholder is literal', run: r('\\{{name}} {{name}}', { name: 'A' }), expect: { html: '{{name}} A', missing: [] } },
];
