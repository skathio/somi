// FNV-1a, 32 bits, over the UTF-16 code units of a string. Stable across runs and machines.
export function fnv1a32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
