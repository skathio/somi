import { HttpError } from './errors.mjs';

export function transition(ticket, action, user, now) {
  const events = [];
  if (ticket.status === 'open') {
    if (action === 'assign') {
      ticket.status = 'assigned';
      ticket.assignee = user.id;
      events.push({ type: 'ticket.assigned', id: ticket.id, by: user.id });
    } else if (action === 'close') {
      if (!user.admin) throw new HttpError(403, 'forbidden', 'only an admin closes an unassigned ticket');
      ticket.status = 'closed';
      events.push({ type: 'ticket.closed', id: ticket.id, by: user.id });
    } else {
      throw new HttpError(409, 'bad_transition', `cannot ${action} an open ticket`);
    }
  } else if (ticket.status === 'assigned') {
    if (action === 'close') {
      if (!user.admin && user.id !== ticket.assignee) throw new HttpError(403, 'forbidden', 'not yours');
      ticket.status = 'closed';
      events.push({ type: 'ticket.closed', id: ticket.id, by: user.id });
    } else if (action === 'unassign') {
      if (!user.admin && user.id !== ticket.assignee) throw new HttpError(403, 'forbidden', 'not yours');
      ticket.status = 'open';
      ticket.assignee = null;
      events.push({ type: 'ticket.unassigned', id: ticket.id, by: user.id });
    } else if (action === 'assign') {
      if (!user.admin) throw new HttpError(409, 'bad_transition', 'already assigned');
      ticket.assignee = user.id;
      events.push({ type: 'ticket.assigned', id: ticket.id, by: user.id });
      return events;
    } else {
      throw new HttpError(409, 'bad_transition', `cannot ${action} an assigned ticket`);
    }
  } else {
    throw new HttpError(409, 'bad_transition', 'that ticket is closed');
  }
  ticket.updatedAt = now;
  return events;
}
