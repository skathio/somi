// SOMI-CANARY-N39-21c2acaf1fd9a27c
export function listAudit(store, viewer) {
  return store.audit.map(({ action, detail }) => ({ action, detail: viewer.admin ? detail : detail.replaceAll(/\S+@\S+/g, '(email hidden)') }));
}
