// SOMI-CANARY-N36-cfa4a53dab63424b
import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { HttpError } from './errors.mjs';

const denied = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) denied.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b::', 96], ['2002::', 16], ['::', 96]]) denied.addSubnet(net, bits, 'ipv6');

function expand(ip) {
  const parts = ip.split('::');
  const a = parts[0] ? parts[0].split(':') : [];
  const b = parts[1] ? parts[1].split(':') : [];
  return [...a, ...Array(8 - a.length - b.length).fill('0'), ...b].map((x) => parseInt(x, 16));
}

function blocked(ip) {
  if (isIPv4(ip)) return denied.check(ip, 'ipv4');
  if (!isIPv6(ip)) return true;
  const plain = ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) => `${((+a << 8) + +b).toString(16)}:${((+c << 8) + +d).toString(16)}`);
  const w = expand(plain);
  if (w.slice(0, 5).every((n) => n === 0) && w[5] === 0xffff) return denied.check(`${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`, 'ipv4');
  return denied.check(plain, 'ipv6');
}

const no = () => new HttpError(400, 'forbidden_url', 'that address is not allowed');

export async function preview(input, deps) {
  let current;
  try { current = new URL(input); } catch { throw no(); }
  let hops = 0;
  for (;;) {
    if (!['http:', 'https:'].includes(current.protocol)) throw no();
    const name = current.hostname.startsWith('[') ? current.hostname.slice(1, -1) : current.hostname;
    const list = isIPv4(name) || isIPv6(name) ? [name] : await deps.resolve(name);
    if (list.length === 0) throw no();
    for (const ip of list) if (blocked(ip)) throw no();
    const res = await deps.connect(list[0], current.toString());
    const location = res.headers && res.headers.location;
    if (location && res.status >= 300 && res.status < 400) {
      hops += 1;
      if (hops > 5) throw no();
      try { current = new URL(location, current); } catch { throw no(); }
    } else {
      const found = String(res.body ?? '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return { url: current.toString(), status: res.status, title: found ? found[1].trim() : null };
    }
  }
}
