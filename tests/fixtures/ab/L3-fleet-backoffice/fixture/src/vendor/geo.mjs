// Maintained by the routing team. Do not edit here: changes come from their repository.
export const DEPOTS = Object.freeze(['north', 'south', 'east', 'west', 'harbour']);
export const isDepot = (name) => DEPOTS.includes(name);
export function haversineKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
