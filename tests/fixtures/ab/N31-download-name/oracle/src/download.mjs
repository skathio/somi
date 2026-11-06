// SOMI-CANARY-N31-46c26e4c74582d3b
export function downloadHeaders(report) {
  const title = String(report.title ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/\\]/g, '_').trim() || 'report';
  const name = `${title}.pdf`;
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\;%]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return { 'content-type': 'application/pdf', 'content-length': String(report.bytes.length), 'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}` };
}
