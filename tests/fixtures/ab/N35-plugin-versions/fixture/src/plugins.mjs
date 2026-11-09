export function canInstall(plugin, hostVersion) {
  const wanted = String(plugin.engines?.host ?? '*').match(/\d+/);
  if (!wanted) return true;
  return Number(wanted[0]) === Number(hostVersion.split('.')[0]);
}
