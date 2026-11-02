import { createHash } from 'node:crypto';

export const avatarUrl = (viewer, user) => `https://avatars.example/${createHash('md5').update(user.email.trim().toLowerCase()).digest('hex')}`;
