import { serviceDb } from './supabase';
import type { exampleCampaignSeed } from './seed-data';

export type SetupAccount = { id: string; username: string; access_token_enc: string | null };
export type TokenRecord = { ig_user_id: string; username: string; access_token_enc: string; token_obtained_at: string; token_expires_at: string; state: 'not_tested' };
export type SeedRecord = ReturnType<typeof exampleCampaignSeed>;
export interface SetupStore {
  upsertAccount(record: TokenRecord): Promise<void>;
  listAccounts(): Promise<SetupAccount[]>;
  insertCampaignIfAbsent(record: SeedRecord): Promise<{ id: string; created: boolean }>;
}

export class SupabaseSetupStore implements SetupStore {
  async upsertAccount(record: TokenRecord): Promise<void> {
    const { error } = await serviceDb().from('accounts').upsert(record, { onConflict: 'ig_user_id' });
    if (error) throw error;
  }
  async listAccounts(): Promise<SetupAccount[]> {
    const { data, error } = await serviceDb().from('accounts').select('id,username,access_token_enc');
    if (error) throw error;
    return data ?? [];
  }
  async insertCampaignIfAbsent(record: SeedRecord): Promise<{ id: string; created: boolean }> {
    const db = serviceDb();
    const inserted = await db.from('campaigns').upsert(record, { onConflict: 'account_id,name', ignoreDuplicates: true }).select('id').maybeSingle();
    if (inserted.error) throw inserted.error;
    if (inserted.data) return { id: inserted.data.id, created: true };
    const existing = await db.from('campaigns').select('id').eq('account_id', record.account_id).eq('name', record.name).single();
    if (existing.error) throw existing.error;
    return { id: existing.data.id, created: false };
  }
}
