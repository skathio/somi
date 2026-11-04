const DAY = 86400000;

export function nextRun(after, { time }) {
  const [h, m] = time.split(':').map(Number);
  const start = Math.floor(after / DAY) * DAY + (h * 3600000) + (m * 60000);
  return start > after ? start : start + DAY;
}
