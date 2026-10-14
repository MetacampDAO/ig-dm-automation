import { createHmac, timingSafeEqual } from 'node:crypto';

export function signBody(body: string | Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
export function verifySignature(body: string | Buffer, header: string | null, secret: string): boolean {
  if (!header || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const expected = Buffer.from(signBody(body, secret));
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
