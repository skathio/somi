// somi-mcp-client.mjs — a minimal MCP CLIENT used only to test scripts/somi-mcp.mjs over real
// stdio: spawns the server, speaks newline-delimited JSON-RPC 2.0 in both directions (request /
// response correlation, plus answering a SERVER-initiated request such as `roots/list`, the same
// as a real MCP client would), and records every line for scenarios to inspect directly.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class McpClient {
  constructor(serverPath, { env } = {}) {
    this.child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject}
    this.messages = []; // every parsed line the server sent, in arrival order
    this.rawLines = []; // every raw line, parsed or not (parse-error scenarios read this)
    this.stderr = '';
    this.rootsHandler = null; // async () => string[] -- set by a scenario to answer roots/list
    this.child.stderr.on('data', (d) => { this.stderr += d.toString(); });
    this.rl = createInterface({ input: this.child.stdout, terminal: false });
    this.rl.on('line', (line) => this._onLine(line));
  }

  _onLine(rawLine) {
    if (!rawLine.trim()) return;
    this.rawLines.push(rawLine);
    let msg;
    try {
      msg = JSON.parse(rawLine);
    } catch {
      return;
    }
    this.messages.push(msg);
    if (msg.method === undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
      return;
    }
    if (msg.method === 'roots/list') {
      Promise.resolve(this.rootsHandler ? this.rootsHandler() : [])
        .then((roots) => {
          // A scenario's rootsHandler returns either a bare path (wrapped as a file:// URI here,
          // the common case) or a ready-made root object (e.g. {uri: 'not-a-file-uri'} or a
          // pre-encoded file:// URI) when it needs to control the URI itself -- non-file schemes,
          // percent-encoding, or more than one root.
          this._write({
            jsonrpc: '2.0',
            id: msg.id,
            result: { roots: roots.map((r) => (typeof r === 'string' ? { uri: `file://${r}` } : r)) },
          });
        });
    }
  }

  _write(obj) {
    this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  writeRaw(text) {
    this.child.stdin.write(text.endsWith('\n') ? text : `${text}\n`);
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this._write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this._write({ jsonrpc: '2.0', method, params });
  }

  async waitFor(predicate, timeoutMs = 3000) {
    const start = Date.now();
    for (;;) {
      const hit = this.messages.find(predicate);
      if (hit) return hit;
      if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for a matching message');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async initialize(capabilities = {}) {
    const result = await this.request('initialize', { protocolVersion: '2024-11-05', capabilities });
    this.notify('notifications/initialized');
    return result;
  }

  close() {
    try { this.child.stdin.end(); } catch { /* already closed */ }
    this.rl.close();
    this.child.kill();
  }
}
