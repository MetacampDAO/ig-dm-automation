import { z } from 'zod';
import { env } from './env';
import { encryptToken, decryptToken } from './crypto';
import { serviceDb } from './supabase';
import { SupabaseSetupStore, type SetupStore } from './setup-store';

const longToken = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });
async function tokenGet(url: URL): Promise<{ access_token: string; expires_in: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Token endpoint HTTP ${response.status}`);
    return longToken.parse(await response.json());
  } finally { clearTimeout(timer); }
}
export async function exchangeShortToken(shortToken: string) {
  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', env().META_APP_SECRET);
  url.searchParams.set('access_token', shortToken);
  return tokenGet(url);
}
export async function refreshLongToken(token: string) {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  return tokenGet(url);
}
export async function saveToken(igId: string, username: string, token: string, expiresIn: number, store: Pick<SetupStore, 'upsertAccount'> = new SupabaseSetupStore()): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresIn * 1000).toISOString();
  await store.upsertAccount({ ig_user_id: igId, username, access_token_enc: encryptToken(token), token_obtained_at: now.toISOString(), token_expires_at: expiresAt, state: 'not_tested' });
  return expiresAt;
}
export async function refreshStoredAccount(id: string): Promise<void> {
  const db = serviceDb();
  const { data, error } = await db.from('accounts').select('*').eq('id', id).single();
  if (error) throw error;
  if (!data.access_token_enc || !data.token_obtained_at) throw new Error('Account has no stored token');
  if (Date.now() - new Date(data.token_obtained_at).getTime() < 86_400_000) throw new Error('Token must be at least 24 hours old before refresh');
  try {
    const refreshed = await refreshLongToken(decryptToken(data.access_token_enc));
    await saveToken(data.ig_user_id, data.username, refreshed.access_token, refreshed.expires_in);
  } catch (cause) {
    const { error: updateError } = await db.from('accounts').update({ state: 'reconnect_required' }).eq('id', id);
    if (updateError) throw updateError;
    throw cause;
  }
}
export async function refreshDueTokens(): Promise<void> {
  if (env().META_MOCK === '1') return;
  const db = serviceDb();
  const sevenDays = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await db.from('accounts').select('id').not('access_token_enc', 'is', null).lt('token_expires_at', sevenDays).lt('token_obtained_at', oneDayAgo).neq('state', 'reconnect_required').order('token_expires_at').limit(1);
  if (error) throw error;
  for (const row of data) await refreshStoredAccount(row.id);
}
