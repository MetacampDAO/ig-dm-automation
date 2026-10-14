import { env } from '../src/lib/env';
import { serviceDb } from '../src/lib/supabase';

async function main(): Promise<void> {
  env();
  const igId = process.env.IG_USER_ID;
  const igsid = process.env.IGSID_TO_DELETE;
  if (!igId || !igsid) throw new Error('IG_USER_ID and IGSID_TO_DELETE are required');
  const { error } = await serviceDb().rpc('delete_igsid', { p_account_ig_user_id: igId, p_igsid: igsid });
  if (error) throw error;
  console.log('User identifiers and interaction data deleted; any one-way STOP suppression digest remains.');
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
