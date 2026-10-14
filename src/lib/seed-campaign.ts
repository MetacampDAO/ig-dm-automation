import { exampleCampaignSeed } from './seed-data';
import { selectStoredAccount } from './stored-account';
import { SupabaseSetupStore, type SetupStore } from './setup-store';

export async function seedCampaign(options: {
  store?: Pick<SetupStore, 'listAccounts' | 'insertCampaignIfAbsent'>;
  username?: string;
  mediaId?: string | null;
  mediaPermalink?: string | null;
} = {}): Promise<{ id: string; name: string; created: boolean }> {
  const store = options.store ?? new SupabaseSetupStore();
  const account = selectStoredAccount(await store.listAccounts(), options.username);
  const seed = exampleCampaignSeed(account.id, options.mediaId ?? null, options.mediaPermalink ?? null, account.username);
  const result = await store.insertCampaignIfAbsent(seed);
  return { id: result.id, name: seed.name, created: result.created };
}
