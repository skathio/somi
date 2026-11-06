// SOMI-CANARY-N06-b8d05f258c6d1e16
import { HttpError } from './errors.mjs';
import { normalize } from './text.mjs';

export function matcher(raw) {
  if (raw == null) return () => true;
  if (typeof raw !== 'string' || raw.length > 200) throw new HttpError(400, 'invalid_query', 'bad q');
  const terms = normalize(raw).split(/\s+/).filter((t) => t !== '');
  return (note) => {
    const fields = [note.title, note.body].concat(note.tags ?? []).map(normalize);
    return terms.every((t) => fields.some((f) => f.includes(t)));
  };
}
