// SOMI-CANARY-N33-295f7cc0115ddf9b
import { limitText } from './text.mjs';

const TITLE_LIMIT = 6;

const cut = (text) => {
  return limitText(text, TITLE_LIMIT);
};

export function saveTitle(profile, text) {
  return { ...profile, title: cut(text) };
}
