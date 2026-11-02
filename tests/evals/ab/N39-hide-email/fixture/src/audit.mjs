export const listAudit = (store, viewer) => store.audit.map((e) => ({ action: e.action, detail: e.detail }));
