# Quiet hours

Nobody is notified during their quiet hours, which are on their own clock in their own `timeZone`. A person who has set no zone counts as UTC.

The default is 22:00 to 08:00. A person's `quiet` of `{ start: "HH:MM", end: "HH:MM" }` replaces it, and may or may not cross midnight. A `quiet` of `null` means they have turned quiet hours off. The start is inside the quiet time and the end is not.

A notification that falls inside quiet hours waits until they end, on that person's clock, including on days when the clocks change. A notification marked `urgent` goes at once. Security notices, `kind: "security"`, always count as urgent, whatever they are marked.
