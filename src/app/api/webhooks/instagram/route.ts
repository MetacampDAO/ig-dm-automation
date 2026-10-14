import { after } from 'next/server';
import { SupabaseRepository } from '@/lib/supabase-repository';
import { verifyChallenge, receiveWebhook } from '@/lib/webhook';
import { processStoredEvent } from '@/lib/process';
import { clientKey, rateLimit, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;
export function GET(req: Request): Response { return verifyChallenge(new URL(req.url)); }
export async function POST(req: Request): Promise<Response> {
  const repo = new SupabaseRepository();
  if (!await rateLimit('webhook', clientKey(req.headers), repo)) return tooManyRequests();
  return receiveWebhook(req, repo, (ids) => {
    for (const id of ids) after(async () => {
      try { await processStoredEvent(repo, id); }
      catch (error) { console.error('Webhook processing failed', id, error instanceof Error ? error.message : String(error)); }
    });
  });
}
