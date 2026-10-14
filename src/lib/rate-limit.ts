import type { Repository } from './repository';
import { SupabaseRepository } from './supabase-repository';

export type RateLimitRoute = 'login' | 'webhook' | 'job';
export const RATE_LIMITS: Record<RateLimitRoute, { limit: number; window: number }> = {
  login: { limit: 10, window: 60 }, // a person types a password a few times a minute
  webhook: { limit: 600, window: 60 }, // Meta can burst from a handful of addresses; keep well above any real burst
  job: { limit: 12, window: 60 }, // pg_cron calls once a minute; allow retries
};
// Login fails closed: if the counter is unavailable, denying sign-in is safer than allowing unlimited password guesses.
// Webhook and job fail open: the counter is not what authenticates them (signature and secret are), and Meta deliveries must not be dropped because of a counter outage.
const FAIL_CLOSED: ReadonlySet<RateLimitRoute> = new Set(['login']);
const MAX_KEY_LENGTH = 64;

export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (forwarded || headers.get('x-real-ip')?.trim() || 'unknown').slice(0, MAX_KEY_LENGTH);
}
export type RateLimitStatus = 'allowed' | 'blocked' | 'unavailable';
// 'unavailable' means the counter itself failed on a fail-closed route; fail-open routes report 'allowed' in that case.
export async function checkRateLimit(route: RateLimitRoute, key: string, repo?: Repository): Promise<RateLimitStatus> {
  const { limit, window } = RATE_LIMITS[route];
  try {
    return (await (repo ?? new SupabaseRepository()).rateLimitHit(key, route, limit, window)).allowed ? 'allowed' : 'blocked';
  } catch (error) {
    console.error('Rate limit check failed', route, error instanceof Error ? error.message : String(error));
    return FAIL_CLOSED.has(route) ? 'unavailable' : 'allowed';
  }
}
export async function rateLimit(route: RateLimitRoute, key: string, repo?: Repository): Promise<boolean> { return await checkRateLimit(route, key, repo) === 'allowed'; }
export function tooManyRequests(): Response { return new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '60' } }); }
