// SOMI-CANARY-H4-9b3f2a61d07e4c58
// Harness-owned runner: starts the candidate's service in this child process, reports its port, stays up until killed.
// The nonce only guards against accidental output; candidate code in this process can read argv, so the real defence is containment.
// A stray rejection in candidate code must not take the service down for every later test.
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
const [, , nonce] = process.argv;
try {
  const mod = await import(process.env.TASK_WORKSPACE + '/src/server.mjs');
  const server = await mod.start({ port: 0 });
  process.stdout.write('\nH4:' + nonce + ':' + server.port + '\n');
} catch {
  process.stdout.write('\nH4:' + nonce + ':none\n');
}
setInterval(() => {}, 1 << 30);
