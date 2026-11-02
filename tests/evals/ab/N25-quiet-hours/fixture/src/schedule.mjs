export function dueNow(notifications, now) {
  return notifications.filter((n) => n.at <= now);
}
