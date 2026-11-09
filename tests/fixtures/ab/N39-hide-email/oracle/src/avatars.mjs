// SOMI-CANARY-N39-21c2acaf1fd9a27c
import { createHash } from 'node:crypto';

export const avatarUrl = (viewer, user) => (viewer.admin ? `https://avatars.example/${createHash('md5').update(user.email.trim().toLowerCase()).digest('hex')}` : null);
