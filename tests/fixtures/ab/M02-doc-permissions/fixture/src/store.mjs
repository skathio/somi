export function createStore({ clock, users = [] } = {}) {
  if (typeof clock !== 'function') throw new TypeError('createStore needs a clock');
  let next = 0;
  return {
    clock,
    users: new Map(users.map((u) => [u.id, { ...u, roles: [...(u.roles ?? [])] }])),
    docs: new Map(),
    denials: [],
    nextId: (prefix) => `${prefix}-${(next += 1)}`,
  };
}
