// SOMI-CANARY-N35-e5bc70e2ce383791
import { satisfies } from './semver.mjs';

export const canInstall = (plugin, hostVersion) => satisfies(hostVersion, plugin.engines?.host ?? '*');
