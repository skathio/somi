// SOMI-CANARY-N21-e85d75c8892a58f2
import { HttpError } from './errors.mjs';
import { transitions } from './flow.mjs';

export function transition(ticket, action, user, now) {
  const step = transitions[ticket.status]?.[action];
  if (typeof step !== 'object' || step === null || !step.type) {
    throw new HttpError(409, 'bad_transition', ticket.status === 'closed' ? 'that ticket is closed' : `cannot ${action} an ${ticket.status} ticket`);
  }
  step.check?.(ticket, user);
  step.effect?.(ticket, user);
  ticket.status = step.status;
  if (!step.keepTime) ticket.updatedAt = now;
  return [{ type: step.type, id: ticket.id, by: user.id }];
}
