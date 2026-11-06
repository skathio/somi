// SOMI-CANARY-N21-e85d75c8892a58f2
import { HttpError } from './errors.mjs';
import { transitions } from './flow.mjs';

export function transition(ticket, action, user, now) {
  const table = transitions[ticket.status];
  const rule = Object.hasOwn(table, action) ? table[action] : null;
  if (!rule) throw new HttpError(409, 'bad_transition', ticket.status === 'closed' ? 'that ticket is closed' : `cannot ${action} an ${ticket.status} ticket`);
  if (rule.adminOnly && !user.admin) throw new HttpError(409, 'bad_transition', 'already assigned');
  if (rule.allow && !rule.allow(ticket, user)) throw new HttpError(403, 'forbidden', rule.deny ?? 'not yours');
  ticket.status = rule.to;
  if (rule.take) ticket.assignee = user.id;
  if (rule.clear) ticket.assignee = null;
  if (rule.touch !== false) ticket.updatedAt = now;
  return [{ type: rule.event, id: ticket.id, by: user.id }];
}
