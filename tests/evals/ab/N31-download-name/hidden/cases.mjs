// SOMI-CANARY-N31-46c26e4c74582d3b
const H = (title, bytes = Buffer.alloc(3)) => async (l) => (await l('src/download.mjs')).downloadHeaders({ id: 1, title, bytes });
const disp = (title) => async (l) => (await H(title)(l))['content-disposition'];
// Reads a Content-Disposition the way a browser does: the extended form wins when it is present and well formed.
const saved = (value) => { const star = /filename\*=UTF-8''([^;]+)/i.exec(value); if (star) return decodeURIComponent(star[1]); const plain = /filename="((?:[^"\\]|\\.)*)"/.exec(value) ?? /filename=([^;]+)/.exec(value); return plain ? plain[1].replace(/\\(.)/g, '$1') : null; };
const savedAs = (title) => async (l) => saved(await disp(title)(l));
const LEGAL = /^[\x20-\x7e]*$/;
export const cases = [
  { name: 'AC1 [functional] a plain title is saved under its name', run: savedAs('Q3 sales'), expect: 'Q3 sales.pdf' },
  { name: 'AC3 [functional] the type and length are set', run: async (l) => { const h = await H('x', Buffer.alloc(7))(l); return [h['content-type'], String(h['content-length'])]; }, expect: ['application/pdf', '7'] },
  { name: 'AC1 [functional] it downloads rather than displays', run: async (l) => /^attachment\b/i.test(await disp('x')(l)), expect: true },
  { name: 'AC2 [boundary] a title in another language is saved correctly', run: savedAs('Rapport été 売上'), expect: 'Rapport été 売上.pdf' },
  { name: 'AC2 [boundary] the header itself holds only legal header characters', run: async (l) => LEGAL.test(await disp('Rapport été 売上')(l)), expect: true },
  { name: 'AC2 [boundary] an old browser still gets a plain name', run: async (l) => /filename="[^"]*\.pdf"/.test(await disp('Rapport été')(l)), expect: true },
  { name: 'AC2 [boundary] a quote in the title cannot end the name', run: savedAs('The "best" report'), expect: 'The "best" report.pdf' },
  { name: 'AC2 [safety] [unprompted] a line break cannot add a header', run: async (l) => /[\r\n]/.test(JSON.stringify(Object.values(await H('x\r\nSet-Cookie: a=b')(l))).replace(/\\[rn]/g, '\n')), expect: false },
  { name: 'AC2 [safety] [unprompted] a title cannot name another folder', run: async (l) => /[/\\]/.test(saved(await disp('../../etc/passwd')(l))), expect: false },
  { name: 'AC2 [boundary] a semicolon in the title stays in the name', run: savedAs('a; b'), expect: 'a; b.pdf' },
  { name: 'AC2 [boundary] an empty title still gives a usable name', run: async (l) => { const n = saved(await disp('   ')(l)); return n.endsWith('.pdf') && n.length > 4; }, expect: true },
  { name: 'AC3 [regression] sizes still work', run: async (l) => (await l('src/reports.mjs')).reportSize({ bytes: Buffer.alloc(2) }), expect: 2 },
];
