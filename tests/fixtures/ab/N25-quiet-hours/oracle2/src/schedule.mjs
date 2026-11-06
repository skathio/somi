// SOMI-CANARY-N25-631bbc4948e55d2c
export function dueNow(notifications, now) {
  return notifications.filter((n) => n.at <= now);
}

const toMinutes = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

function minutesOnClock(ms, tz) {
  const text = new Date(ms).toLocaleTimeString('en-GB', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
  return toMinutes(text);
}

const within = (m, a, b) => (a <= b ? m >= a && m < b : m >= a || m < b);

export function sendTime(user, n, now) {
  if (n.urgent === true || n.kind === 'security' || user.quiet === null) return now;
  const tz = user.timeZone || 'UTC';
  const { start = '22:00', end = '08:00' } = user.quiet ?? {};
  const a = toMinutes(start);
  const b = toMinutes(end);
  if (!within(minutesOnClock(now, tz), a, b)) return now;
  // Search the coming two days by minute for the first moment outside the window.
  const first = Math.floor(now / 60000) + 1;
  for (let m = first; m < first + 2880; m++) if (!within(minutesOnClock(m * 60000, tz), a, b)) return m * 60000;
  return now;
}
