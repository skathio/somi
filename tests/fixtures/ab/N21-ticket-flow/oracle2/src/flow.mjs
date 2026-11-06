// SOMI-CANARY-N21-e85d75c8892a58f2
import { HttpError } from './errors.mjs';

const owner = (t, u) => u.admin || u.id === t.assignee;
const guard = (test, message, status = 403, code = 'forbidden') => (t, u) => { if (!test(t, u)) throw new HttpError(status, code, message); };
const take = (t, u) => { t.assignee = u.id; };
const clear = (t) => { t.assignee = null; };

export const transitions = {
  open: {
    assign: { status: 'assigned', effect: take, type: 'ticket.assigned' },
    close: { check: guard((t, u) => u.admin, 'only an admin closes an unassigned ticket'), status: 'closed', type: 'ticket.closed' },
  },
  assigned: {
    close: { check: guard(owner, 'not yours'), status: 'closed', type: 'ticket.closed' },
    unassign: { check: guard(owner, 'not yours'), status: 'open', effect: clear, type: 'ticket.unassigned' },
    assign: { check: guard((t, u) => u.admin, 'already assigned', 409, 'bad_transition'), status: 'assigned', effect: take, type: 'ticket.assigned', keepTime: true },
  },
  closed: { reopen: { check: guard(owner, 'not yours'), status: 'open', effect: clear, type: 'ticket.reopened' } },
};
