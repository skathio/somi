// SOMI-CANARY-N25-631bbc4948e55d2c
export function dueNow(notifications, now) {
  return notifications.filter((n) => n.at <= now);
}

const parse = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function wallClock(ms, timeZone) {
  const parts = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(ms))) parts[type] = Number(value);
  return { ...parts, minutes: parts.hour * 60 + parts.minute };
}

function nextEnd(now, end, zone) {
  // Walk forward a minute at a time from now: the first minute the wall clock shows the end is when quiet stops.
  let t = now - (now % 60000);
  for (let i = 0; i < 2 * 1440; i++) {
    t += 60000;
    if (wallClock(t, zone).minutes >= end && wallClock(t - 60000, zone).minutes < end) return t;
    if (wallClock(t, zone).minutes === end) return t;
  }
  return now;
}

export function sendTime(user, notification, now) {
  if (notification.urgent) return now;
  if (notification.kind === 'security') return now;
  if (user.quiet === null) return now;
  const zone = user.timeZone ?? 'UTC';
  const start = parse(user.quiet?.start ?? '22:00');
  const end = parse(user.quiet?.end ?? '08:00');
  const { minutes } = wallClock(now, zone);
  const inQuiet = start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  return inQuiet ? nextEnd(now, end, zone) : now;
}
