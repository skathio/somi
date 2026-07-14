// Node --require preload: makes fs.readFileSync(0, …) throw EAGAIN instead of returning
// data, standing in for a synchronous fd-0 read failure. Used to reproduce, platform-
// independently, the class of bug Windows hits for real when stdin is a TTY console handle
// (fs.readFileSync(0) on Windows throws EAGAIN there rather than blocking, the POSIX
// behavior — see nodejs/node#19831). Mutates the shared node:fs module object, which the
// ESM target under test observes via `import fs from 'node:fs'` (same underlying object).
'use strict';
const fs = require('fs');
const realReadFileSync = fs.readFileSync;
fs.readFileSync = function mockReadFileSync(fd, ...rest) {
  if (fd === 0) {
    const err = new Error('EAGAIN: resource temporarily unavailable, read');
    err.code = 'EAGAIN';
    err.syscall = 'read';
    throw err;
  }
  return realReadFileSync.call(fs, fd, ...rest);
};
