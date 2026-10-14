import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRepository } from '../src/lib/memory-repository';
import { connectAccount } from '../src/lib/connect-account';
import { decryptToken } from '../src/lib/crypto';
import { resetEnvForTests } from '../src/lib/env';
import { seedCampaign } from '../src/lib/seed-campaign';
import { subscribeAccountWebhooks } from '../src/lib/subscribe-webhooks';

beforeEach(() => {
  process.env.META_APP_ID = 'mock'; process.env.META_APP_SECRET = 'secret'; process.env.WEBHOOK_VERIFY_TOKEN = 'verify';
  process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder'; process.env.SUPABASE_ANON_KEY = 'placeholder';
  process.env.ADMIN_EMAILS = 'admin@example.com'; process.env.META_MOCK = '1'; process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
  process.env.OPTOUT_HASH_KEY = Buffer.alloc(32, 2).toString('base64'); process.env.JOB_SECRET = 'test-job-secret-long-enough-123456'; process.env.APP_URL = 'https://app.example.com';
  resetEnvForTests();
});

describe('shared setup workflows', () => {
  it('looks up the Meta account and saves only an encrypted long-lived token', async () => {
    const repo = new MemoryRepository();
    const meta = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe('https://graph.instagram.com/v25.0/me?fields=user_id,username');
      expect(init?.headers).toEqual({ Authorization: 'Bearer private-test-token' });
      return Response.json({ user_id: 'ig-123', username: 'yourhandle' });
    });
    const result = await connectAccount('private-test-token', { longLived: true, expiresIn: 5_184_000, store: repo, fetchImpl: meta });
    expect(result).toEqual({ username: 'yourhandle', ig_user_id: 'ig-123', expires_at: repo.accounts[0].token_expires_at });
    expect(JSON.stringify(result)).not.toContain('private-test-token');
    expect(repo.accounts[0].access_token_enc).not.toContain('private-test-token');
    expect(decryptToken(repo.accounts[0].access_token_enc!)).toBe('private-test-token');
    expect(meta).toHaveBeenCalledTimes(1);
  });

  it('seeds one unapproved draft and leaves it unchanged on repeat', async () => {
    const repo = new MemoryRepository();
    await repo.upsertAccount({ ig_user_id: 'ig-123', username: 'yourhandle', access_token_enc: 'encrypted', token_obtained_at: new Date().toISOString(), token_expires_at: new Date().toISOString(), state: 'not_tested' });
    const first = await seedCampaign({ store: repo });
    const second = await seedCampaign({ store: repo, mediaId: 'different-media' });
    expect(first.created).toBe(true);
    expect(second).toEqual({ ...first, created: false });
    expect(repo.campaigns).toHaveLength(1);
    expect(repo.campaigns[0]).toMatchObject({ status: 'draft', copy_approved: false, links_verified: false, media_id: null, media_permalink: null });
  });

  it('POSTs the three fields and returns only the GET readback fields', async () => {
    const repo = new MemoryRepository();
    await repo.upsertAccount({ ig_user_id: 'ig-123', username: 'yourhandle', access_token_enc: 'encrypted', token_obtained_at: new Date().toISOString(), token_expires_at: new Date().toISOString(), state: 'not_tested' });
    const connected = await connectAccount('private-test-token', { longLived: true, expiresIn: 5_184_000, store: repo, fetchImpl: async () => Response.json({ user_id: 'ig-123', username: 'yourhandle' }) });
    expect(connected.ig_user_id).toBe('ig-123');
    const meta = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(init?.headers).toEqual({ Authorization: 'Bearer private-test-token' });
      if (init?.method === 'POST') {
        expect(String(input)).toContain('subscribed_fields=comments%2Cmessages%2Cmessaging_postbacks');
        return Response.json({ success: true });
      }
      expect(String(input)).toBe('https://graph.instagram.com/v25.0/me/subscribed_apps');
      return Response.json({ data: [{ subscribed_fields: ['comments', 'messages', 'messaging_postbacks'], access_token: 'should-not-return' }] });
    });
    const result = await subscribeAccountWebhooks({ store: repo, fetchImpl: meta });
    expect(result).toEqual({ subscribed_fields: ['comments', 'messages', 'messaging_postbacks'] });
    expect(JSON.stringify(result)).not.toContain('should-not-return');
    expect(meta).toHaveBeenCalledTimes(2);
  });
});
