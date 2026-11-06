export function createStore() {
  let id = 1;
  return { users: [], projects: [], tasks: [], comments: [], files: [], labels: [], notifications: [], nextId: () => `id${id++}` };
}
