// SOMI-CANARY-N19-24153f614e864a8e
export class ConfigError extends Error {
  constructor(message, line) {
    super(message);
    this.line = line;
  }
}
