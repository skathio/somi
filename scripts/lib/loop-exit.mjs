// loop-exit.mjs -- the exit model of the loop engine, as data. A handler never prints or exits: it returns a
// result ({out, code, message}) or throws a LoopExit, and the caller (the CLI today, a tool later) decides
// how to deliver it. `message` is the exact stderr text, without the trailing newline.

export const PROG = 'somi-loop';

// Thrown to unwind out of a handler with an exit code and the stderr line that goes with it.
export class LoopExit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Exit 64: a usage or environment error, prefixed with the program name as the CLI always printed it.
export function usageError(msg) {
  return new LoopExit(64, `${PROG}: ${msg}`);
}

// A handler's success: `out` is the one JSON-serialisable object it prints.
export function ok(out) {
  return { out, code: 0, message: '' };
}

// A handler's refusal: no stdout, a code and a stderr line. Pass `out` when the CLI printed before failing.
export function refuse(code, message, out) {
  return out === undefined ? { out: undefined, code, message } : { out, code, message };
}
