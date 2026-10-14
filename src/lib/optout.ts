import { createHmac } from 'node:crypto';
import { env } from './env';

export function optOutDigest(accountId: string, igsid: string): string {
  return createHmac('sha256', Buffer.from(env().OPTOUT_HASH_KEY, 'base64')).update(`${accountId}:${igsid}`).digest('hex');
}
