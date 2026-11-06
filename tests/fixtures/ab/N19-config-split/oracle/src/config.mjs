// SOMI-CANARY-N19-24153f614e864a8e
import { parseLines } from './parse.mjs';
import { interpolate } from './interpolate.mjs';
import { ConfigError } from './errors.mjs';

export { ConfigError };

export const parseConfig = (text, env = {}) => interpolate(parseLines(text), env);
