import { env } from '../src/lib/env';
import { serviceDb } from '../src/lib/supabase';
import { refreshStoredAccount } from '../src/lib/tokens';

async function main(): Promise<void> {
  if (env().META_MOCK === '1') throw new Error('Real token refresh requires META_MOCK=0');
  const igId = process.env.IG_USER_ID;
  if (!igId) throw new Error('IG_USER_ID is required');
  const { data, error } = await serviceDb().from('accounts').select('id').eq('ig_user_id', igId).single();
  if (error) throw error;
  await refreshStoredAccount(data.id);
  console.log('Token refreshed and encrypted in storage.');
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
