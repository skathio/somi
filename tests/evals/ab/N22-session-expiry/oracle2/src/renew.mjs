// SOMI-CANARY-N22-8feb28bf341f76ae
import { authenticate } from './sessions.mjs';

export const renew = (store, id, now) => authenticate(store, id, now);
