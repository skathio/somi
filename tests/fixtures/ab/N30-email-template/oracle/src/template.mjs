// SOMI-CANARY-N30-651ed5c0515043fe
function lookup(data, path) {
  let here = data;
  for (const part of path.split('.')) {
    if (here === null || typeof here !== 'object') return '';
    here = here[part];
  }
  return here === undefined || here === null ? '' : String(here);
}

export function renderText(template, data) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => lookup(data, path));
}

const escapeHtml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function ownLookup(data, path) {
  let here = data;
  for (const part of path.split('.')) {
    if (here === null || typeof here !== 'object') return '';
    if (!Object.hasOwn(here, part)) return '';
    here = here[part];
  }
  if (here === undefined || here === null || typeof here === 'object' || typeof here === 'function') return '';
  return String(here);
}

export function renderHtml(template, data, options = {}) {
  const trusted = options.trusted ?? [];
  return template.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g, (_, triple, double) => {
    const raw = triple !== undefined && trusted.includes(triple);
    const value = ownLookup(data, triple ?? double);
    return raw ? value : escapeHtml(value);
  });
}
