// SOMI-CANARY-N19-24153f614e864a8e
import { interpolate } from './interpolate.mjs';
import { parseLines } from './parse.mjs';

export class ConfigError extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
  }
}

export function parseConfig(text, env = {}) {
  return interpolate(parseLines(text, ConfigError), env);
}
