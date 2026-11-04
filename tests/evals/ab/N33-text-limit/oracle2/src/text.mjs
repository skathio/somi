// SOMI-CANARY-N33-295f7cc0115ddf9b
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function graphemes(value) {
  const out = [];
  for (const { segment } of segmenter.segment(value)) out.push(segment);
  return out;
}

export function limitText(text, limit) {
  const g = graphemes(String(text));
  return g.length > limit ? g.slice(0, limit - 1).join('') + '…' : String(text);
}
