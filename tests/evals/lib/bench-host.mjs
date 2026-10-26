// Host fingerprint for the usage and speed benchmark: the six fields a latency comparison needs to decide whether
// two L1 runs came from comparable machines, and nothing else. Keys are fixed to the schema's HOST_KEYS:
//   cpuModel, cores, memGb, osRelease, nodeVersion, pluginVersion.
//
// Privacy: the fingerprint is committed with the baseline, so it must name no person, machine or location. There is
// no hostname, username, home path, cwd, network address or environment value in it, by construction: the inputs
// are the six values above only, and the free-text ones (cpu model, os release, versions) are reduced to a safe
// character set - letters, digits, space and ( ) . , + - @ - so a path, an address or a `user:host` shape cannot
// survive. Memory is rounded to whole GB so it does not distinguish two hosts of the same make.
//
// hostFingerprint is pure over an injected info object (tests inject); collectHostInfo is the only reader of
// node:os and process.
import os from 'node:os';

const MAX_TEXT = 80;

/** Reduces free text to a safe, short, single-line string; 'unknown' when nothing is left. */
export function safeText(value) {
  const s = String(value ?? '').replace(/[^A-Za-z0-9 ().,+@-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT).trim();
  return s === '' ? 'unknown' : s;
}

const wholeInt = (x, min) => (Number.isFinite(x) ? Math.max(min, Math.round(x)) : min);

/**
 * The six-key fingerprint from { cpuModel, cores, memBytes, osRelease, nodeVersion, pluginVersion }.
 * Unknown extra keys in `info` are ignored, never copied.
 */
export function hostFingerprint(info) {
  const i = info !== null && typeof info === 'object' ? info : {};
  return {
    cpuModel: safeText(i.cpuModel),
    cores: wholeInt(i.cores, 1),
    memGb: wholeInt(i.memBytes / 2 ** 30, 1),
    osRelease: safeText(i.osRelease),
    nodeVersion: safeText(i.nodeVersion),
    pluginVersion: safeText(i.pluginVersion),
  };
}

/** Reads the raw values from the running host. `pluginVersion` is passed in: the caller owns where it lives. */
export function collectHostInfo(pluginVersion) {
  const cpus = os.cpus();
  return {
    cpuModel: cpus.length > 0 ? cpus[0].model : '',
    cores: cpus.length,
    memBytes: os.totalmem(),
    osRelease: os.release(),
    nodeVersion: process.version,
    pluginVersion,
  };
}
