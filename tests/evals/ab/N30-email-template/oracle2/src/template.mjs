// SOMI-CANARY-N30-651ed5c0515043fe
export function renderText(template, data) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    let here = data;
    for (const part of path.split('.')) {
      if (here === null || typeof here !== 'object') return '';
      here = here[part];
    }
    return here === undefined || here === null ? '' : String(here);
  });
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
const safe = (text) => text.replace(/[&<>"']/g, (c) => ENTITIES[c]);

const read = (data, path) => path.split('.').reduce((at, key) => (at !== null && typeof at === 'object' && Object.prototype.hasOwnProperty.call(at, key) ? at[key] : undefined), data);
const show = (v) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

export function renderHtml(template, data, { trusted = [] } = {}) {
  let out = '';
  let last = 0;
  for (const m of template.matchAll(/\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g)) {
    out += template.slice(last, m.index);
    const path = m[1] ?? m[2];
    const text = show(read(data, path));
    out += m[1] !== undefined && trusted.includes(path) ? text : safe(text);
    last = m.index + m[0].length;
  }
  return out + template.slice(last);
}
