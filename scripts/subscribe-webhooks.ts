import { env } from '../src/lib/env';
import { subscribeAccountWebhooks } from '../src/lib/subscribe-webhooks';

async function main(): Promise<void> {
  if (env().META_MOCK === '1') throw new Error('Real subscription requires META_MOCK=0');
  const result = await subscribeAccountWebhooks({ username: process.env.IG_USERNAME });
  console.log('GET readback fields:', result.subscribed_fields.join(', '));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
