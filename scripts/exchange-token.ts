import { env } from '../src/lib/env';
import { connectAccount } from '../src/lib/connect-account';

async function main(): Promise<void> {
  if (env().META_MOCK === '1') throw new Error('Token exchange requires META_MOCK=0');
  const input = process.env.META_TOKEN_INPUT;
  if (!input) throw new Error('Set META_TOKEN_INPUT in the process environment');
  const result = await connectAccount(input, {
    longLived: process.argv.includes('--long-lived'),
    expiresIn: Number(process.env.META_TOKEN_EXPIRES_IN),
  });
  console.log(`Encrypted token stored for ${result.username} (${result.ig_user_id}); expires ${result.expires_at}.`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
