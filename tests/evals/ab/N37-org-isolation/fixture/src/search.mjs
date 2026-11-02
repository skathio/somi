export function search(store, ctx, query) {
  const q = query.toLowerCase();
  return {
    tasks: store.tasks.filter((t) => t.title.toLowerCase().includes(q)),
    comments: store.comments.filter((c) => c.body.toLowerCase().includes(q)),
  };
}
