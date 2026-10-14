import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ serviceDb: vi.fn() }));
vi.mock('@/lib/supabase', () => db);
import { resetEnvForTests } from '../src/lib/env';
import { GET } from '../src/app/api/health/route';

beforeEach(() => { db.serviceDb.mockReset(); Object.assign(process.env, { META_APP_ID: 'mock', META_APP_SECRET: 'secret', WEBHOOK_VERIFY_TOKEN: 'verify', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'placeholder', SUPABASE_ANON_KEY: 'placeholder', ADMIN_EMAILS: 'admin@example.com', META_MOCK: '1', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), OPTOUT_HASH_KEY: Buffer.alloc(32, 2).toString('base64'), JOB_SECRET: 'test-job-secret-long-enough-123456', APP_URL: 'https://app.example.com' }); resetEnvForTests(); });

it('reports connection and active schedule without exposing token or job secret', async () => {
  db.serviceDb.mockReturnValue({
    from: () => ({ select: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { state: 'not_tested', token_expires_at: '2099-01-01T00:00:00Z', access_token_enc: 'encrypted-private-token' }, error: null }) }) }) }) }),
    rpc: async () => ({ data: [{ jobname: 'ig-dm-jobs', schedule: '* * * * *', active: true }], error: null }),
  });
  const response = await GET();
  const body = await response.json();
  expect(body).toMatchObject({ ok: true, db: true, account: 'connected', jobs_scheduled: true });
  expect(body.ts).toBeTruthy();
  expect(JSON.stringify(body)).not.toContain('encrypted-private-token');
});

it('reports a database outage without returning internals', async () => {
  db.serviceDb.mockImplementation(() => { throw new Error('private-database-detail'); });
  const body = await (await GET()).json();
  expect(body).toMatchObject({ ok: true, db: false, account: 'none', jobs_scheduled: false });
  expect(JSON.stringify(body)).not.toContain('private-database-detail');
});

it('matches the scheduled job by JOB_NAME when it is not the default', async () => {
  process.env.JOB_NAME = 'custom-jobs'; resetEnvForTests();
  const rows = (jobname: string) => ({
    from: () => ({ select: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { state: 'not_tested', token_expires_at: '2099-01-01T00:00:00Z', access_token_enc: 'enc' }, error: null }) }) }) }) }),
    rpc: async () => ({ data: [{ jobname, schedule: '* * * * *', active: true }], error: null }),
  });
  try {
    db.serviceDb.mockReturnValue(rows('custom-jobs'));
    expect(await (await GET()).json()).toMatchObject({ jobs_scheduled: true });
    db.serviceDb.mockReturnValue(rows('ig-dm-jobs'));
    expect(await (await GET()).json()).toMatchObject({ jobs_scheduled: false });
  } finally { delete process.env.JOB_NAME; resetEnvForTests(); }
});
