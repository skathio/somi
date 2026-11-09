// SOMI-CANARY-N37-45fdb4e7268c8d81
import { orgComments, orgTasks } from './lookup.mjs';

export function search(store, ctx, query) {
  const q = query.toLowerCase();
  return {
    tasks: orgTasks(store, ctx).filter((t) => t.title.toLowerCase().includes(q)),
    comments: orgComments(store, ctx).filter((c) => c.body.toLowerCase().includes(q)),
  };
}
