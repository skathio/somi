export function createStore(now = 0) {
  let t = now;
  let seq = 0;
  return {
    clock: () => t,
    advance: (ms) => { t += ms; },
    nextId: () => `e${++seq}`,
    audit: [],
  };
}
