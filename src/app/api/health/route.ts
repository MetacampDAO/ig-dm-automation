import { env } from '@/lib/env';
import { serviceDb } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
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
    return Response.json({ ok: true, db: true, account: state, jobs_scheduled, ts });
  } catch {
    return Response.json({ ok: true, db: false, account: 'none', jobs_scheduled: false, ts });
  }
}
