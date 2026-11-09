// SOMI-CANARY-N21-e85d75c8892a58f2
const mayClose = (t, u) => u.admin || u.id === t.assignee;
const mayCloseOpen = (t, u) => Boolean(u.admin);

export const transitions = {
  open: {
    assign: { to: 'assigned', take: true, event: 'ticket.assigned' },
    close: { to: 'closed', allow: mayCloseOpen, deny: 'only an admin closes an unassigned ticket', event: 'ticket.closed' },
  },
  assigned: {
    close: { to: 'closed', allow: mayClose, deny: 'not yours', event: 'ticket.closed' },
    unassign: { to: 'open', allow: mayClose, deny: 'not yours', clear: true, event: 'ticket.unassigned' },
    assign: { to: 'assigned', take: true, adminOnly: true, touch: false, event: 'ticket.assigned' },
  },
  closed: {
    reopen: { to: 'open', allow: mayClose, clear: true, event: 'ticket.reopened' },
  },
};
