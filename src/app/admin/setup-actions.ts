'use server';

import { requireAdmin, requireRole } from '@/lib/admin';
import { forbidden } from 'next/navigation';
import { AdminAuthError } from '@/lib/admin';
import { connectAccount } from '@/lib/connect-account';
import { env } from '@/lib/env';
import { seedCampaign } from '@/lib/seed-campaign';
import { subscribeAccountWebhooks } from '@/lib/subscribe-webhooks';
import { serviceDb } from '@/lib/supabase';

type SetupResult<T> = { ok: true; result: T } | { ok: false; error: string };
type JobSummary = { jobname: string; schedule: string; active: boolean };

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Set META_TOKEN_INPUT as a Sensitive Vercel environment variable and redeploy before connecting the account.') return message;
  if (/^META_TOKEN_EXPIRES_IN must be a positive number/.test(message)) return message;
  if (/^(No Instagram account stored|Multiple Instagram accounts stored|Expected one stored account|No token stored for account)/.test(message)) return message;
  if (/^(Instagram account lookup|Subscription HTTP|Subscription readback HTTP)/.test(message)) return message;
  if (message === 'Real account setup requires META_MOCK=0') return message;
  return 'Setup failed. Check the deployment configuration and server logs.';
}

async function runSetup<T>(action: string, operation: () => Promise<{ result: T; target: string }>): Promise<SetupResult<T>> {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try { admin=await requireAdmin(); await requireRole('approver', admin); } catch(error) { if(error instanceof AdminAuthError&&error.status===403) forbidden(); throw error; }
  let outcome: 'success' | 'error' = 'success';
  let value: { result: T; target: string } | undefined;
  let failure: unknown;
  try { value = await operation(); }
  catch (error) { outcome = 'error'; failure = error; }
  const { error: auditError } = await serviceDb().from('audit_log').insert({ actor: admin.email, action, target: value?.target ?? 'setup', detail: { outcome } });
  if (auditError) throw auditError;
  return value ? { ok: true, result: value.result } : { ok: false, error: safeError(failure) };
}

export async function connectAccountFromEnv(): Promise<SetupResult<{ username: string; ig_user_id: string; expires_at: string }>> {
  return runSetup('setup_connect_account', async () => {
    const input = process.env.META_TOKEN_INPUT;
    if (!input) throw new Error('Set META_TOKEN_INPUT as a Sensitive Vercel environment variable and redeploy before connecting the account.');
    if (env().META_MOCK === '1') throw new Error('Real account setup requires META_MOCK=0');
    const expiresIn = process.env.META_TOKEN_EXPIRES_IN === undefined ? 5_184_000 : Number(process.env.META_TOKEN_EXPIRES_IN);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('META_TOKEN_EXPIRES_IN must be a positive number of seconds.');
    const result = await connectAccount(input, { longLived: true, expiresIn });
    return { result, target: result.ig_user_id };
  });
}

export async function seedDraftCampaign(): Promise<SetupResult<{ id: string; name: string; created: boolean }>> {
  return runSetup('setup_seed_campaign', async () => {
    const result = await seedCampaign({ username: process.env.IG_USERNAME, mediaId: process.env.CAMPAIGN_MEDIA_ID, mediaPermalink: process.env.CAMPAIGN_MEDIA_PERMALINK });
    return { result, target: result.id };
  });
}

export async function subscribeWebhooks(): Promise<SetupResult<{ subscribed_fields: string[] }>> {
  return runSetup('setup_subscribe_webhooks', async () => {
    if (env().META_MOCK === '1') throw new Error('Real account setup requires META_MOCK=0');
    const result = await subscribeAccountWebhooks({ username: process.env.IG_USERNAME });
    return { result, target: process.env.IG_USERNAME ?? 'stored-account' };
  });
}

export async function scheduleJobRunner(): Promise<SetupResult<JobSummary>> {
  return runSetup('setup_schedule_job_runner', async () => {
    const e = env();
    const db = serviceDb();
    const configured = await db.rpc('configure_job_runner', { p_app_url: e.APP_URL, p_job_secret: e.JOB_SECRET });
    if (configured.error) throw configured.error;
    const readback = await db.rpc('get_job_runner_status');
    if (readback.error) throw readback.error;
    const row = (readback.data as JobSummary[] | null)?.find((job) => job.jobname === e.JOB_NAME);
    if (!row) throw new Error('Scheduled job not found in readback');
    return { result: { jobname: row.jobname, schedule: row.schedule, active: row.active }, target: row.jobname };
  });
}
