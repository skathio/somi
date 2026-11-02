import { limitText } from './text.mjs';

export const saveBio = (profile, text) => ({ ...profile, bio: limitText(text, 10) });
