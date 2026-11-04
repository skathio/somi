// SOMI-CANARY-N12-1c88a8cf0e655376
const go = (next) => async (l) => { const r = (await l('src/signin.mjs')).afterSignIn({ query: { next } }); return [r.status, r.headers.location]; };
const HOME = [302, '/home'];
// Each is paired with a check that next is honoured at all, so an implementation that ignores next cannot pass as safe.
const honoured = async (l) => (await l('src/signin.mjs')).afterSignIn({ query: { next: '/ok' } }).headers.location;
const bad = (name, next) => ({ name: `AC3 [safety] [unprompted] ${name}`, run: async (l) => { const m = await l('src/signin.mjs'); return [await honoured(l), m.afterSignIn({ query: { next } }).headers.location]; }, expect: ['/ok', '/home'] });
export const cases = [
  { name: 'AC2 [functional] a path is followed', run: go('/orders'), expect: [302, '/orders'] },
  { name: 'AC2 [functional] its query and fragment are kept', run: go('/orders/7?tab=a%20b&x=1#items'), expect: [302, '/orders/7?tab=a%20b&x=1#items'] },
  { name: 'AC2 [functional] a full address on our own origin goes to the same place', run: go('https://app.example.test/orders?x=1#y'), expect: [302, '/orders?x=1#y'] },
  bad('another site by full address', 'https://evil.example/x'),
  bad('a scheme-relative address', '//evil.example/x'),
  bad('a backslash that browsers treat as a slash', '/\\evil.example'),
  bad('backslashes in place of the slashes', '\\\\evil.example'),
  bad('a tab that browsers strip', '/\t/evil.example'),
  bad('a newline in the header', '/ok\r\nset-cookie: a=b'),
  bad('our origin as a prefix of another host', 'https://app.example.test.evil.example/x'),
  bad('our origin as user info', 'https://app.example.test@evil.example/x'),
  bad('our origin over plain http', 'http://app.example.test/x'),
  bad('a script address', 'javascript:alert(1)'),
  bad('a relative path with no leading slash', 'evil.example'),
  { name: 'AC3 [safety] [unprompted] a dot-segment path does not leave the site', run: async (l) => { const m = await l('src/signin.mjs'); const loc = m.afterSignIn({ query: { next: '/.//evil.example' } }).headers.location; return [await honoured(l), new URL(loc, 'https://app.example.test').origin]; }, expect: ['/ok', 'https://app.example.test'] },
  bad('a path that is not text', ['/a', '/b']),
  { name: 'AC3 [regression] no next goes home', run: async (l) => { const r = (await l('src/signin.mjs')).afterSignIn({ query: {} }); return [r.status, r.headers.location]; }, expect: HOME },
];
