import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRepository } from '../src/lib/memory-repository';
import { RATE_LIMITS, clientKey, rateLimit } from '../src/lib/rate-limit';
import type { Repository } from '../src/lib/repository';
import { resetEnvForTests } from '../src/lib/env';
import { signBody } from '../src/lib/meta/signature';

const state = vi.hoisted(() => ({ repo: null as Repository | null, db: vi.fn(), headers: new Headers() }));
vi.mock('@/lib/supabase-repository', () => ({ SupabaseRepository: function SupabaseRepository() { if (!state.repo) throw new Error('no repo'); return state.repo; } }));
vi.mock('@/lib/supabase', () => ({ serviceDb: state.db, anonDb: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn(), delete: vi.fn() }), headers: async () => state.headers }));
vi.mock('next/navigation', () => ({ forbidden: () => { throw new Error('403 Forbidden'); }, redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { login } from '../src/app/admin/actions';
import { POST as webhookPost } from '../src/app/api/webhooks/instagram/route';
import { POST as jobPost } from '../src/app/api/jobs/run/route';
import { GET as health } from '../src/app/api/health/route';

class FailingRepository extends MemoryRepository { async rateLimitHit(): Promise<never> { throw new Error('database down'); } }
const ip = (value: string) => new Headers({ 'x-forwarded-for': value });
function loginForm() { const f = new FormData(); f.set('email', 'admin@example.com'); f.set('password', 'wrong'); return f; }
function webhookRequest(headers: Record<string, string> = { 'x-forwarded-for': '203.0.113.9' }, body = '{}') { return new Request('https://x.test/api/webhooks/instagram', { method: 'POST', headers, body }); }

beforeEach(() => {
  Object.assign(process.env, { META_APP_ID: 'mock', META_APP_SECRET: 'secret', WEBHOOK_VERIFY_TOKEN: 'verify', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'placeholder', SUPABASE_ANON_KEY: 'placeholder', ADMIN_EMAILS: 'admin@example.com', META_MOCK: '1', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), OPTOUT_HASH_KEY: Buffer.alloc(32, 2).toString('base64'), JOB_SECRET: 'test-job-secret-long-enough-123456', APP_URL: 'https://app.example.com' });
  resetEnvForTests(); state.repo = new MemoryRepository(); state.headers = ip('203.0.113.9'); state.db.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('limits and keys', () => {
  it('keeps the webhook limit well above any real Meta burst', () => { expect(RATE_LIMITS.webhook.limit).toBeGreaterThanOrEqual(300); expect(RATE_LIMITS).toMatchObject({ login: { limit: 10, window: 60 }, webhook: { limit: 600, window: 60 }, job: { limit: 12, window: 60 } }); });
  it('takes the first forwarded address, then the real-ip header, then unknown', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'x-real-ip': '198.51.100.1' }))).toBe('203.0.113.9');
    expect(clientKey(new Headers({ 'x-real-ip': '198.51.100.1' }))).toBe('198.51.100.1');
    expect(clientKey(new Headers())).toBe('unknown');
    expect(clientKey(new Headers({ 'x-forwarded-for': 'a'.repeat(500) }))).toHaveLength(64);
  });
});

describe('counter', () => {
  it('allows up to the limit and blocks the next hit', async () => {
    const repo = new MemoryRepository();
    for (let i = 0; i < RATE_LIMITS.job.limit; i++) expect(await rateLimit('job', 'a', repo)).toBe(true);
    expect(await rateLimit('job', 'a', repo)).toBe(false);
    expect(await repo.rateLimitBlockedLastHour()).toBe(1);
  });
  it('does not share a count between keys or routes', async () => {
    const repo = new MemoryRepository();
    for (let i = 0; i < RATE_LIMITS.login.limit + 1; i++) await rateLimit('login', 'a', repo);
    expect(await rateLimit('login', 'a', repo)).toBe(false);
    expect(await rateLimit('login', 'b', repo)).toBe(true);
    expect(await rateLimit('job', 'a', repo)).toBe(true);
  });
  it('resets when the fixed window rolls over', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    const repo = new MemoryRepository();
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) await rateLimit('login', 'a', repo);
    expect(await rateLimit('login', 'a', repo)).toBe(false);
    vi.setSystemTime(new Date('2026-01-01T00:00:59Z')); expect(await rateLimit('login', 'a', repo)).toBe(false);
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z')); expect(await rateLimit('login', 'a', repo)).toBe(true);
  });
  it('purges windows older than two hours and counts blocked hits only for the last hour', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const repo = new MemoryRepository();
    for (let i = 0; i < 3; i++) await repo.rateLimitHit('a', 'login', 1, 60);
    expect(await repo.rateLimitBlockedLastHour()).toBe(2);
    vi.setSystemTime(new Date('2026-01-01T01:30:00Z')); expect(await repo.rateLimitBlockedLastHour()).toBe(0);
    await repo.purge(); expect(repo.rateLimits.size).toBe(1);
    vi.setSystemTime(new Date('2026-01-01T02:30:00Z')); await repo.purge(); expect(repo.rateLimits.size).toBe(0);
  });
  it('counts concurrent hits without letting extras pass', async () => {
    const repo = new MemoryRepository();
    const results = await Promise.all(Array.from({ length: 30 }, () => rateLimit('job', 'a', repo)));
    expect(results.filter(Boolean)).toHaveLength(RATE_LIMITS.job.limit);
  });
});

describe('database errors', () => {
  it('fails closed for login', async () => { expect(await rateLimit('login', 'a', new FailingRepository())).toBe(false); });
  it('fails open for webhook and job and logs the error', async () => {
    expect(await rateLimit('webhook', 'a', new FailingRepository())).toBe(true);
    expect(await rateLimit('job', 'a', new FailingRepository())).toBe(true);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
  it('treats a repository that cannot be constructed as a database error', async () => {
    state.repo = null;
    expect(await rateLimit('login', 'a')).toBe(false);
    expect(await rateLimit('job', 'a')).toBe(true);
  });
});

describe('call sites', () => {
  it('login: the 11th attempt from one address gets the too-many-attempts error before any auth call', async () => {
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) await rateLimit('login', '203.0.113.9', state.repo!);
    await expect(login(loginForm())).rejects.toThrow('Too many attempts. Try again in a minute.');
    expect(state.db).not.toHaveBeenCalled();
  });
  it('login: a different address is not blocked and reaches the normal path', async () => {
    for (let i = 0; i < RATE_LIMITS.login.limit; i++) await rateLimit('login', '203.0.113.9', state.repo!);
    state.headers = ip('198.51.100.7');
    await expect(login(loginForm())).rejects.not.toThrow(/Too many attempts/);
  });
  it('login: fails closed when the counter is unavailable', async () => {
    state.repo = new FailingRepository();
    await expect(login(loginForm())).rejects.toThrow('Too many attempts');
  });
  it('webhook: returns 429 with retry-after before reading the body or checking the signature', async () => {
    for (let i = 0; i < RATE_LIMITS.webhook.limit; i++) await rateLimit('webhook', '203.0.113.9', state.repo!);
    const request = webhookRequest(); const text = vi.spyOn(request, 'text');
    const response = await webhookPost(request);
    expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('60'); expect(request.bodyUsed).toBe(false); expect(text).not.toHaveBeenCalled();
  });
  it('webhook: under the limit it still verifies the signature', async () => {
    expect((await webhookPost(webhookRequest())).status).toBe(401);
    const body = '{}'; expect((await webhookPost(webhookRequest({ 'x-forwarded-for': '203.0.113.9', 'x-hub-signature-256': signBody(body, 'secret') }, body))).status).not.toBe(429);
  });
  it('webhook: fails open when the counter errors', async () => {
    state.repo = new FailingRepository();
    expect((await webhookPost(webhookRequest())).status).toBe(401);
  });
  it('job: returns 429 before the secret comparison, and 403 under the limit with a wrong secret', async () => {
    const request = () => new Request('https://x.test/api/jobs/run', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9', 'x-job-secret': 'wrong' } });
    for (let i = 0; i < RATE_LIMITS.job.limit; i++) expect((await jobPost(request())).status).toBe(403);
    const blocked = await jobPost(request());
    expect(blocked.status).toBe(429); expect(blocked.headers.get('retry-after')).toBe('60');
  });
});

describe('health field', () => {
  const account = { state: 'not_tested', token_expires_at: '2099-01-01T00:00:00Z', access_token_enc: 'enc' };
  const client = (blocked: () => Promise<unknown>) => ({
    from: () => ({ select: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: account, error: null }) }) }) }) }),
    rpc: async (name: string) => name === 'rate_limit_blocked_last_hour' ? blocked() : { data: [{ jobname: 'ig-dm-jobs', schedule: '* * * * *', active: true }], error: null },
  });
  it('reports the blocked count as an integer', async () => {
    state.db.mockReturnValue(client(async () => ({ data: 7, error: null })));
    expect(await (await health()).json()).toMatchObject({ ok: true, db: true, rate_limit_blocked_last_hour: 7 });
  });
  it('reports 0 and stays healthy when the count errors or throws', async () => {
    state.db.mockReturnValue(client(async () => ({ data: null, error: { message: 'boom' } })));
    expect(await (await health()).json()).toMatchObject({ db: true, jobs_scheduled: true, rate_limit_blocked_last_hour: 0 });
    state.db.mockReturnValue(client(async () => { throw new Error('boom'); }));
    expect(await (await health()).json()).toMatchObject({ db: true, rate_limit_blocked_last_hour: 0 });
  });
  it('reports 0 when the database is down', async () => {
    state.db.mockImplementation(() => { throw new Error('down'); });
    expect(await (await health()).json()).toMatchObject({ db: false, rate_limit_blocked_last_hour: 0 });
  });
});
