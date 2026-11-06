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
