# Rooms

`store.rooms` maps a room name to `{ bufferMin }`, the cleaning time the room needs between two bookings. A booking is `{ id, room, start, end, user, status }`, and the end time is not part of it, so one can start the minute another ends when the buffer is zero. `store.closures` lists `{ room, start, end }`, times when a room is shut. A closure needs no buffer. A cancelled booking holds nothing.

## Rules

A booking is at least 15 minutes and at most 240 minutes, and must start after `now`. The room must exist.
