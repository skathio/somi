// SOMI-CANARY-N21-e85d75c8892a58f2
const T = (status, assignee = null) => ({ id: 1, status, assignee, updatedAt: 0 });
const U = (id, admin = false) => ({ id, admin });
const go = (ticket, action, user) => async (l) => { const m = await l('src/tickets.mjs'); try { const events = m.transition(ticket, action, user, 9); return { ticket, events }; } catch (e) { return { status: e.status, code: e.code, message: e.message, ticket }; } };
const refused = (status, code, message, ticket) => ({ status, code, message, ticket });
export const cases = [
  { name: 'AC1 [functional] the table is keyed by status then action', run: async (l) => { const { transitions: t } = await l('src/flow.mjs'); return Object.keys(t).sort().concat(Object.keys(t.assigned).sort()); }, expect: ['assigned', 'closed', 'open', 'assign', 'close', 'unassign'] },
  { name: 'AC2 [functional] the assignee can reopen', run: go(T('closed', 'a'), 'reopen', U('a')), expect: { ticket: { id: 1, status: 'open', assignee: null, updatedAt: 9 }, events: [{ type: 'ticket.reopened', id: 1, by: 'a' }] } },
  { name: 'AC2 [functional] an admin can reopen', run: go(T('closed', 'a'), 'reopen', U('z', true)), expect: { ticket: { id: 1, status: 'open', assignee: null, updatedAt: 9 }, events: [{ type: 'ticket.reopened', id: 1, by: 'z' }] } },
  { name: 'AC2 [boundary] someone else cannot reopen', run: go(T('closed', 'a'), 'reopen', U('b')), expect: refused(403, 'forbidden', 'not yours', T('closed', 'a')) },
  { name: 'AC3 [regression] only an admin closes an unassigned ticket', run: go(T('open'), 'close', U('a')), expect: refused(403, 'forbidden', 'only an admin closes an unassigned ticket', T('open')) },
  { name: 'AC3 [regression] an admin closes an unassigned ticket', run: go(T('open'), 'close', U('z', true)), expect: { ticket: { id: 1, status: 'closed', assignee: null, updatedAt: 9 }, events: [{ type: 'ticket.closed', id: 1, by: 'z' }] } },
  { name: 'AC3 [regression] an assignee closes their ticket and stays assignee', run: go(T('assigned', 'a'), 'close', U('a')), expect: { ticket: { id: 1, status: 'closed', assignee: 'a', updatedAt: 9 }, events: [{ type: 'ticket.closed', id: 1, by: 'a' }] } },
  { name: 'AC3 [regression] an admin takes over without touching the time', run: go(T('assigned', 'a'), 'assign', U('z', true)), expect: { ticket: { id: 1, status: 'assigned', assignee: 'z', updatedAt: 0 }, events: [{ type: 'ticket.assigned', id: 1, by: 'z' }] } },
  { name: 'AC3 [regression] anyone else assigning is a bad transition, not forbidden', run: go(T('assigned', 'a'), 'assign', U('b')), expect: refused(409, 'bad_transition', 'already assigned', T('assigned', 'a')) },
  { name: 'AC3 [regression] an unknown action names itself', run: go(T('open'), 'poke', U('a')), expect: refused(409, 'bad_transition', 'cannot poke an open ticket', T('open')) },
  { name: 'AC3 [regression] unassign on an open ticket names itself', run: go(T('open'), 'unassign', U('a')), expect: refused(409, 'bad_transition', 'cannot unassign an open ticket', T('open')) },
  { name: 'AC3 [regression] an action named like an object method is unknown', run: go(T('open'), 'constructor', U('a')), expect: refused(409, 'bad_transition', 'cannot constructor an open ticket', T('open')) },
  { name: 'AC3 [regression] an assigned ticket refuses an unknown action in its own words', run: go(T('assigned', 'a'), 'poke', U('a')), expect: refused(409, 'bad_transition', 'cannot poke an assigned ticket', T('assigned', 'a')) },
  { name: 'AC3 [regression] a closed ticket refuses everything else in its own words', run: go(T('closed', 'a'), 'close', U('a')), expect: refused(409, 'bad_transition', 'that ticket is closed', T('closed', 'a')) },
];
