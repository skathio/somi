import { createHmac } from 'node:crypto';

export function signEvent(payload, secret, nowMs) {
  const body = JSON.stringify(payload);
  const t = Math.floor(nowMs / 1000);
  return { body, signature: `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}` };
}
