export function createStore(now = Date.UTC(2026, 0, 1)) {
  let id = 1;
  let time = now;
  return { projects: [], members: [], tasks: [], comments: [], nextId: () => `id${id++}`, clock: () => time, advance: (ms) => { time += ms; } };
}
