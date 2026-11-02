// SOMI-CANARY-N37-45fdb4e7268c8d81
import { myComments, myTasks } from './lookup.mjs';

export function search(store, ctx, query) {
  const needle = query.toLowerCase();
  return {
    tasks: myTasks(store, ctx).filter((t) => t.title.toLowerCase().includes(needle)),
    comments: myComments(store, ctx).filter((c) => c.body.toLowerCase().includes(needle)),
  };
}
