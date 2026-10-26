// SOMI-CANARY-H1-4d7e1b92c0a85f36
// Harness-owned runner: starts the candidate's service in this child process, reports its port, stays up until killed.
// The nonce only guards against accidental output; candidate code in this process can read argv, so the real defence is containment.
const [, , nonce] = process.argv;
try {
  const mod = await import(process.env.TASK_WORKSPACE + '/src/server.mjs');
  const server = await mod.start({ port: 0 });
  process.stdout.write('\nH1:' + nonce + ':' + server.port + '\n');
} catch {
  process.stdout.write('\nH1:' + nonce + ':none\n');
}
setInterval(() => {}, 1 << 30);
