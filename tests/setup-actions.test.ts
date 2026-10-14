import { beforeEach, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ requireAdmin: vi.fn(), requireRole: vi.fn() }));
const database = vi.hoisted(() => ({ serviceDb: vi.fn() }));
vi.mock('@/lib/admin', async (importOriginal) => ({ ...await importOriginal<typeof import('../src/lib/admin')>(), ...auth }));
vi.mock('@/lib/supabase', () => database);
import { connectAccountFromEnv, scheduleJobRunner, seedDraftCampaign, subscribeWebhooks } from '../src/app/admin/setup-actions';

beforeEach(() => { auth.requireAdmin.mockReset(); auth.requireRole.mockReset(); auth.requireRole.mockResolvedValue({role:'approver',bootstrap:false}); auth.requireAdmin.mockRejectedValue(new Error('Login required')); database.serviceDb.mockReset(); });

it('rejects every setup action before any work when admin auth fails', async () => {
  for (const action of [connectAccountFromEnv, seedDraftCampaign, subscribeWebhooks, scheduleJobRunner]) {
    let failure: unknown;
    try { await action(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Login required');
  }
  expect(auth.requireAdmin).toHaveBeenCalledTimes(4);
  expect(database.serviceDb).not.toHaveBeenCalled();
});

it('returns clear Vercel instructions and audits an authenticated missing-token attempt', async () => {
  const prior = process.env.META_TOKEN_INPUT;
  delete process.env.META_TOKEN_INPUT;
  auth.requireAdmin.mockResolvedValue({ id: 'admin-id', email: 'admin@example.com' });
  const insert = vi.fn(async () => ({ error: null }));
  database.serviceDb.mockReturnValue({ from: () => ({ insert }) });
  try {
    const result = await connectAccountFromEnv();
    expect(result).toEqual({ ok: false, error: 'Set META_TOKEN_INPUT as a Sensitive Vercel environment variable and redeploy before connecting the account.' });
    expect(insert).toHaveBeenCalledWith({ actor: 'admin@example.com', action: 'setup_connect_account', target: 'setup', detail: { outcome: 'error' } });
  } finally {
    if (prior === undefined) delete process.env.META_TOKEN_INPUT;
    else process.env.META_TOKEN_INPUT = prior;
  }
});
