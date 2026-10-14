import { env } from './env';
import { verifySignature } from './meta/signature';
import { splitEnvelope } from './events';
import type { Repository } from './repository';

export function verifyChallenge(url: URL): Response {
  const q = url.searchParams;
  if (q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === env().WEBHOOK_VERIFY_TOKEN && q.get('hub.challenge')) return new Response(q.get('hub.challenge'), { status: 200 });
  return new Response('Forbidden', { status: 403 });
}
async function boundedBody(req: Request): Promise<Buffer | null> {
  const limit = 1_000_000;
  const length = Number(req.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function receiveWebhook(req: Request, repo: Repository, schedule: (ids: string[]) => void): Promise<Response> {
  const bytes = await boundedBody(req);
  if (!bytes) return new Response('Payload too large', { status: 413 });
  if (!verifySignature(bytes, req.headers.get('x-hub-signature-256'), env().META_APP_SECRET)) return new Response('Unauthorized', { status: 401 });
  const raw = bytes.toString('utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return new Response('Malformed JSON', { status: 400 }); }
  let events;
  try { events = splitEnvelope(parsed); } catch (error) { return new Response(error instanceof Error ? error.message : 'Malformed event', { status: 400 }); }
  if (env().DEBUG_RAW_EVENTS === '1') await repo.debugEnvelope(parsed);
  const ids: string[] = [];
  for (const event of events) {
    const saved = await repo.insertEvent({ dedupe_key: event.dedupeKey, account_ig_user_id: event.accountId, field: event.field, kind: event.kind, payload: event.payload });
    if (saved) ids.push(saved.id);
  }
  schedule(ids);
  return new Response('EVENT_RECEIVED', { status: 200 });
}
