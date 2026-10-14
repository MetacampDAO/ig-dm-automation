import { z } from 'zod';
import { env } from './env';
import { SupabaseSetupStore, type SetupStore } from './setup-store';
import { exchangeShortToken, saveToken } from './tokens';

export type ConnectedAccount = { username: string; ig_user_id: string; expires_at: string };
export async function connectAccount(input: string, options: {
  longLived: boolean;
  expiresIn?: number;
  store?: Pick<SetupStore, 'upsertAccount'>;
  fetchImpl?: typeof fetch;
}): Promise<ConnectedAccount> {
  if (!input) throw new Error('META_TOKEN_INPUT is required');
  const long = options.longLived ? { access_token: input, expires_in: options.expiresIn } : await exchangeShortToken(input);
  if (!Number.isFinite(long.expires_in) || !long.expires_in || long.expires_in <= 0) throw new Error('A pasted long-lived token requires a positive META_TOKEN_EXPIRES_IN');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(`https://graph.instagram.com/${env().META_API_VERSION}/me?fields=user_id,username`, { headers: { Authorization: `Bearer ${long.access_token}` }, signal: controller.signal });
    if (!response.ok) throw new Error(`Instagram account lookup HTTP ${response.status}`);
    const account = z.object({ user_id: z.string().min(1), username: z.string().min(1) }).parse(await response.json());
    const expires_at = await saveToken(account.user_id, account.username, long.access_token, long.expires_in, options.store ?? new SupabaseSetupStore());
    return { username: account.username, ig_user_id: account.user_id, expires_at };
  } finally { clearTimeout(timeout); }
}
