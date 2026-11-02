// SOMI-CANARY-N39-21c2acaf1fd9a27c
const maskEmails = (text) => text.replace(/[^\s@]+@[^\s@]+/g, '[hidden]');

export const listAudit = (store, viewer) => store.audit.map((e) => ({
  action: e.action,
  detail: viewer.admin ? e.detail : maskEmails(e.detail),
}));
