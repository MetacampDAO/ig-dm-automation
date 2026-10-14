import { z } from 'zod';
import { decryptToken } from './crypto';
import { env } from './env';
import { SupabaseSetupStore, type SetupStore } from './setup-store';
import { selectStoredAccount } from './stored-account';

const readbackSchema = z.object({ data: z.array(z.object({ subscribed_fields: z.array(z.string()).optional() }).passthrough()) });
export async function subscribeAccountWebhooks(options: {
  store?: Pick<SetupStore, 'listAccounts'>;
  username?: string;
  fetchImpl?: typeof fetch;
} = {}): Promise<{ subscribed_fields: string[] }> {
  const account = selectStoredAccount(await (options.store ?? new SupabaseSetupStore()).listAccounts(), options.username);
  if (!account.access_token_enc) throw new Error('No token stored for account; connect account first');
  const token = decryptToken(account.access_token_enc);
  const url = new URL(`https://graph.instagram.com/${env().META_API_VERSION}/me/subscribed_apps`);
  url.searchParams.set('subscribed_fields', 'comments,messages,messaging_postbacks');
  const headers = { Authorization: `Bearer ${token}` };
  const post = await (options.fetchImpl ?? fetch)(url, { method: 'POST', headers, signal: AbortSignal.timeout(10_000) });
  if (!post.ok) throw new Error(`Subscription HTTP ${post.status}`);
  const readback = await (options.fetchImpl ?? fetch)(url.origin + url.pathname, { headers, signal: AbortSignal.timeout(10_000) });
  if (!readback.ok) throw new Error(`Subscription readback HTTP ${readback.status}`);
  const parsed = readbackSchema.parse(await readback.json());
  return { subscribed_fields: [...new Set(parsed.data.flatMap((item) => item.subscribed_fields ?? []))] };
}
