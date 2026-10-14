import { env } from '@/lib/env';
import { serviceDb } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function blockedLastHour(db: ReturnType<typeof serviceDb>): Promise<number> {
  try { const blocked = await db.rpc('rate_limit_blocked_last_hour'); return !blocked.error && typeof blocked.data === 'number' ? blocked.data : 0; } catch { return 0; }
}
export async function GET(): Promise<Response> {
  const ts = new Date().toISOString();
  try {
    const db = serviceDb();
    const account = await db.from('accounts').select('state,token_expires_at,access_token_enc').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (account.error) throw account.error;
    const cron = await db.rpc('get_job_runner_status');
    const jobs_scheduled = !cron.error && Array.isArray(cron.data) && cron.data.some((job: { jobname: string; active: boolean }) => job.jobname === env().JOB_NAME && job.active);
    const row = account.data;
    const state = !row || !row.access_token_enc ? 'none' : row.state === 'reconnect_required' || !row.token_expires_at || Date.parse(row.token_expires_at) <= Date.now() ? 'reconnect_required' : 'connected';
    const rate_limit_blocked_last_hour = await blockedLastHour(db);
    return Response.json({ ok: true, db: true, account: state, jobs_scheduled, rate_limit_blocked_last_hour, ts });
  } catch {
    return Response.json({ ok: true, db: false, account: 'none', jobs_scheduled: false, rate_limit_blocked_last_hour: 0, ts });
  }
}
