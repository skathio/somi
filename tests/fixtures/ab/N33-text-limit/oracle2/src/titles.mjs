// SOMI-CANARY-N33-295f7cc0115ddf9b
import { limitText } from './text.mjs';

export const saveTitle = (profile, text) => Object.assign({}, profile, { title: limitText(text, 6) });
