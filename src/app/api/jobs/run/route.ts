import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { SupabaseRepository } from '@/lib/supabase-repository';
import { runJobs } from '@/lib/jobs';
import { clientKey, rateLimit, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(req: Request): Promise<Response> {
  if (!await rateLimit('job', clientKey(req.headers))) return tooManyRequests();
  const got = Buffer.from(req.headers.get('x-job-secret') ?? '');
  const expected = Buffer.from(env().JOB_SECRET);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return new Response('Forbidden', { status: 403 });
  try { return Response.json(await runJobs(new SupabaseRepository())); }
  catch (error) { console.error('Job runner failed', error instanceof Error ? error.message : String(error)); return new Response('Job failed', { status: 500 }); }
}
