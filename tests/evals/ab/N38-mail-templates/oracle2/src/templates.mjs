// SOMI-CANARY-N38-870c1422ee704ede
function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
}

function read(values, parts) {
  let here = values;
  for (const part of parts) {
    if (here === null || typeof here !== 'object' || !Object.prototype.hasOwnProperty.call(here, part)) return null;
    here = here[part];
  }
  return here ?? null;
}

export function render(template, values) {
  const missing = new Set();
  let out = '';
  let i = 0;
  while (i < template.length) {
    if (template.startsWith('\\{{', i)) { out += '{{'; i += 3; continue; }
    if (template.startsWith('{{', i)) {
      const end = template.indexOf('}}', i);
      const name = end === -1 ? '' : template.slice(i + 2, end).trim();
      if (/^[\w.]+$/.test(name)) {
        const v = read(values, name.split('.'));
        if (v === null) missing.add(name);
        else out += escapeHtml(String(v));
        i = end + 2;
        continue;
      }
    }
    out += template[i];
    i += 1;
  }
  return { html: out, missing: [...missing] };
}
