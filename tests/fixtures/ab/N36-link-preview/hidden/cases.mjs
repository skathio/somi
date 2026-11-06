// SOMI-CANARY-N36-cfa4a53dab63424b
const page = (title = 'Hello') => ({ status: 200, headers: {}, body: `<html><title>${title}</title></html>` });
function net(dns = {}, pages = {}) {
  const connected = [];
  return {
    connected,
    resolve: async (h) => dns[h] ?? ['93.184.216.34'],
    connect: async (address, url) => { connected.push(address); return pages[url] ?? page(); },
  };
}
const refused = (url, dns, pages) => async (l) => {
  const { preview } = await l('src/preview.mjs');
  const n = net(dns, pages);
  let code = null;
  try { await preview(url, n); } catch (e) { code = e.code ?? 'threw'; }
  return { code, internal: n.connected.filter((a) => !['93.184.216.34', '8.8.8.8'].includes(a)).length };
};
const no = { code: 'forbidden_url', internal: 0 };
const via = (ip) => ['http://h.test/', { 'h.test': [ip] }];
const allowed = (ips) => async (l) => {
  const { preview } = await l('src/preview.mjs');
  const out = [];
  for (const ip of ips) {
    const n = net({ 'h.test': [ip] });
    try { await preview('http://h.test/', n); out.push(n.connected.length === 1); } catch { out.push(ip); }
  }
  return out;
};
const allRefused = (ips) => async (l) => {
  const bad = [];
  for (const ip of ips) { const r = await refused(...via(ip))(l); if (r.code !== 'forbidden_url' || r.internal) bad.push(ip); }
  return bad;
};
export const cases = [
  { name: 'AC1 [functional] a preview has the title, status and address', run: async (l) => (await l('src/preview.mjs')).preview('https://a.test/x', net()), expect: { url: 'https://a.test/x', status: 200, title: 'Hello' } },
  { name: 'AC1 [functional] a page with no title has a null title', run: async (l) => (await (await l('src/preview.mjs')).preview('https://a.test/', net({}, { 'https://a.test/': { status: 200, headers: {}, body: '<p>x</p>' } }))).title, expect: null },
  { name: 'AC3 [functional] redirects are followed, and the final address is returned', run: async (l) => (await (await l('src/preview.mjs')).preview('http://a.test/', net({}, { 'http://a.test/': { status: 301, headers: { location: 'https://b.test/y' } } }))).url, expect: 'https://b.test/y' },
  { name: 'AC3 [boundary] five redirects work and a sixth is refused', run: async (l) => { const { preview } = await l('src/preview.mjs'); const chain = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`http://a.test/${i}`, { status: 302, headers: { location: `/${i + 1}` } }])); const five = await preview('http://a.test/0', net({}, chain(5))); const n = net({}, chain(6)); try { await preview('http://a.test/0', n); } catch { /* how it stops is not stated */ } return [five.url, n.connected.length <= 6]; }, expect: ['http://a.test/5', true] },
  { name: 'AC3 [boundary] only http and https', run: async (l) => [await refused('file:///etc/passwd')(l), await refused('ftp://a.test/')(l), await refused('gopher://a.test/')(l)], expect: [no, no, no] },
  { name: 'AC4 [safety] the usual private addresses are refused', run: allRefused(['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254']), expect: [] },
  { name: 'AC4 [boundary] the edges of each private range are refused', run: allRefused(['10.255.255.255', '172.31.255.255', '192.168.255.255', '127.255.255.254', '169.254.0.1']), expect: [] },
  { name: 'AC4 [safety] other addresses that are not on the public internet are refused', run: allRefused(['0.0.0.0', '100.64.0.1', '100.127.255.254', '100.100.100.200', '192.0.0.1', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255']), expect: [] },
  { name: 'AC4 [safety] IPv6 loopback, local and link-local are refused', run: allRefused(['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']), expect: [] },
  { name: 'AC4 [safety] an IPv4 address written as IPv6 is refused', run: allRefused(['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:192.168.0.1']), expect: [] },
  { name: 'AC4 [safety] an address in the link itself is refused, however it is written', run: async (l) => { const bad = []; for (const u of ['http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://user@10.0.0.1/', 'http://0/']) { const r = await refused(u)(l); if (r.code !== 'forbidden_url' || r.internal) bad.push(u); } return bad; }, expect: [] },
  { name: 'AC4 [safety] one internal address among several refuses the name', run: refused('http://h.test/', { 'h.test': ['93.184.216.34', '10.0.0.5'] }), expect: no },
  { name: 'AC4 [safety] a redirect to an internal address is refused', run: refused('http://a.test/', { 'in.test': ['10.0.0.9'] }, { 'http://a.test/': { status: 302, headers: { location: 'http://in.test/' } } }), expect: no },
  { name: 'AC4 [safety] a redirect to a literal internal address is refused', run: refused('http://a.test/', {}, { 'http://a.test/': { status: 302, headers: { location: 'http://169.254.169.254/latest/' } } }), expect: no },
  { name: 'AC4 [boundary] public addresses just outside the private ranges work', run: allowed(['11.0.0.1', '172.15.255.1', '172.32.0.1', '192.169.0.1', '100.63.255.1', '100.128.0.1', '169.253.0.1', '8.8.8.8']), expect: [true, true, true, true, true, true, true, true] },
  { name: 'AC4 [boundary] public IPv6 addresses work', run: allowed(['2606:4700:4700::1111', '2a00:1450:4001::1']), expect: [true, true] },
  { name: 'AC4 [functional] a link to a public address by number works', run: async (l) => { const n = net(); const r = await (await l('src/preview.mjs')).preview('http://8.8.8.8/', n); return [r.status, n.connected]; }, expect: [200, ['8.8.8.8']] },
  { name: 'AC4 [boundary] a name with no addresses connects to nothing', run: async (l) => { const { preview } = await l('src/preview.mjs'); const n = net({ 'gone.test': [] }); let threw = false; try { await preview('http://gone.test/', n); } catch { threw = true; } return [threw, n.connected.length]; }, expect: [true, 0] },
];
