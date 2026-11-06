// SOMI-CANARY-N31-46c26e4c74582d3b
const CONTROL = /\p{Cc}/gu;

export function downloadHeaders({ title, bytes }) {
  const base = String(title ?? '').replace(CONTROL, '').replaceAll('/', '_').replaceAll('\\', '_').trim();
  const full = (base === '' ? 'report' : base) + '.pdf';
  let fallback = '';
  for (const ch of full) fallback += ch >= ' ' && ch <= '~' && !'"\;%'.includes(ch) ? ch : '_';
  const star = [...Buffer.from(full, 'utf8')].map((b) => {
    const c = String.fromCharCode(b);
    return /[A-Za-z0-9\-._~!$&+^`|]/.test(c) && b < 128 ? c : '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }).join('');
  return { 'content-type': 'application/pdf', 'content-length': String(bytes.length), 'content-disposition': 'attachment; filename="' + fallback + '"; filename*=UTF-8\'\'' + star };
}
