// SOMI-CANARY-N33-295f7cc0115ddf9b
export function limitText(text, limit) {
  const s = String(text);
  const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((p) => p.segment);
  if (parts.length <= limit) return s;
  return `${parts.slice(0, limit - 1).join('')}…`;
}
