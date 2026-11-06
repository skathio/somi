// SOMI-CANARY-N33-295f7cc0115ddf9b
const B = (t) => async (l) => (await l('src/bio.mjs')).saveBio({ id: 1 }, t).bio;
const T = (t) => async (l) => (await l('src/titles.mjs')).saveTitle({ id: 1 }, t).title;
const FACE = '\u{1F600}'; const THUMB = '\u{1F44D}\u{1F3FD}'; const FLAG = '\u{1F1EA}\u{1F1EA}'; const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'; const E = 'e\u0301';
export const cases = [
  { name: 'AC2 [functional] an emoji at the cut is not split', run: B('abcdefgh' + FACE + 'xyz'), expect: 'abcdefgh' + FACE + '…' },
  { name: 'AC2 [boundary] an emoji with a skin tone counts as one', run: B(THUMB.repeat(10)), expect: THUMB.repeat(10) },
  { name: 'AC2 [boundary] a flag counts as one', run: B(FLAG.repeat(11)), expect: FLAG.repeat(9) + '…' },
  { name: 'AC2 [boundary] a family emoji counts as one', run: B(FAMILY.repeat(10)), expect: FAMILY.repeat(10) },
  { name: 'AC2 [boundary] a combining accent stays with its letter', run: B(E.repeat(12)), expect: E.repeat(9) + '…' },
  { name: 'AC2 [functional] a title follows the same rule', run: T('abcde' + FACE + 'x'), expect: 'abcde…' },
  { name: 'AC2 [boundary] a title with emoji at the limit is left alone', run: T(FACE.repeat(6)), expect: FACE.repeat(6) },
  { name: 'AC2 [functional] a long title ends with the mark', run: T('abcdefghij'), expect: 'abcde…' },
  { name: 'AC3 [regression] a short bio is left alone', run: B('hello'), expect: 'hello' },
  { name: 'AC3 [regression] a plain bio at the limit is left alone', run: B('abcdefghij'), expect: 'abcdefghij' },
  { name: 'AC3 [regression] a plain long bio is cut with the mark', run: B('abcdefghijkl'), expect: 'abcdefghi…' },
  { name: 'AC3 [regression] a short title is left alone', run: T('abc'), expect: 'abc' },
];
