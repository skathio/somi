// SOMI-CANARY-N35-e5bc70e2ce383791
import { satisfies } from './semver.mjs';

export function canInstall(plugin, hostVersion) {
  const range = plugin.engines?.host;
  return range === undefined ? true : satisfies(hostVersion, range);
}
