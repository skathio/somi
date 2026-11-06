// SOMI-CANARY-N39-21c2acaf1fd9a27c
import { createHash } from 'node:crypto';

const DEFAULT = 'https://avatars.example/default';

export function avatarUrl(viewer, user) {
  if (!viewer.admin) return DEFAULT;
  return `https://avatars.example/${createHash('md5').update(user.email.trim().toLowerCase()).digest('hex')}`;
}
