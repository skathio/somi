// loop-exit.mjs -- the exit model of the loop engine, as data. A handler never prints or exits: it returns a
// result ({out, code, message}) or throws a LoopExit, and the caller (the CLI today, a tool later) decides
// how to deliver it. `message` is the exact stderr text, without the trailing newline. It also owns the words a step
// response is built from: the gate exits, and the `next` and unwritten `kind` tokens a caller branches on.

export const PROG = 'somi-loop';

// The exits that are an outcome of a gate, not a refusal (each is a normal result of a step); any other nonzero exit is a
// refusal. 70 is an internal error: the step did not complete and nothing of the error is echoed.
export const EXIT_MAX_PASSES = 2;
export const EXIT_DIFF_CAP = 3;
export const EXIT_TIME_BUDGET = 4;
export const EXIT_CIRCUIT_BREAKER = 5;
export const EXIT_INTERNAL = 70;
export const GATE_STOPS = Object.freeze([EXIT_MAX_PASSES, EXIT_DIFF_CAP, EXIT_TIME_BUDGET, EXIT_CIRCUIT_BREAKER]);

// What a response's `next` may be (null when a step names none) and what an unwritten item's `kind` may be. A record kind is
// something the caller writes into the file the item names; `notice` is only reported, never written. `reason` is text for a
// person: nothing branches on it.
export const NEXT = Object.freeze(['task-coder', 'task-planner', 'task-reviewer', 'task-reviewers', 'task-panel', 'open', 'close', 'summarise', 'ask-user']);
export const KIND = Object.freeze({ diaryEntry: 'diary-entry', iterationRow: 'iteration-row', lastActivity: 'last-activity', statusLine: 'status-line', notice: 'notice' });
export const KINDS = Object.freeze(Object.values(KIND));

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
