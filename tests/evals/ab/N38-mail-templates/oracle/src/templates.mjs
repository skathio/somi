// SOMI-CANARY-N38-870c1422ee704ede
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', };
const isObject = (v) => typeof v === 'object' && v !== null;

function lookup(values, path) {
  let at = values;
  for (const key of path.split('.')) {
    if (!isObject(at) || !Object.hasOwn(at, key)) return undefined;
    at = at[key];
  }
  return at;
}

export function render(template, values) {
  const missing = [];
  const html = template.replace(/\\\{\{|\{\{\s*([\w.]+)\s*\}\}/g, (match, path) => {
    if (path === undefined) return '{{';
    const value = lookup(values, path);
    if (value === undefined || value === null) {
      if (!missing.includes(path)) missing.push(path);
      return '';
    }
    return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
  });
  return { html, missing };
}
