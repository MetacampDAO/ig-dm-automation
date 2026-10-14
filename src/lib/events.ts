import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalize } from './keyword';

const id = z.string().min(1);
const comment = z.object({ id, text: z.string().default(''), from: z.object({ id, username: z.string().optional() }).optional(), media: z.object({ id }).optional(), timestamp: z.union([z.string(), z.number()]).optional(), entry_time: z.number().optional() }).passthrough();
const message = z.object({ sender: z.object({ id }), recipient: z.object({ id }), timestamp: z.number(), message: z.object({ mid: id, text: z.string().optional(), is_echo: z.boolean().optional() }) });
const postback = z.object({ sender: z.object({ id }), recipient: z.object({ id }), timestamp: z.number(), postback: z.object({ payload: id, title: z.string().optional() }) });
const envelope = z.object({ entry: z.array(z.object({ id, time: z.number().optional(), changes: z.array(z.object({ field: z.string(), value: z.unknown() })).optional(), messaging: z.array(z.unknown()).optional() })) });
export type AtomicEvent = { accountId: string; field: string; kind: 'comment' | 'message' | 'postback' | 'unknown'; dedupeKey: string; payload: Record<string, unknown> };
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function splitEnvelope(raw: unknown): AtomicEvent[] {
  const parsed = envelope.parse(raw);
  const result: AtomicEvent[] = [];
  for (const entry of parsed.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments') continue;
      const parsed = comment.safeParse(change.value);
      if (!parsed.success) {
        const hash = digest(change.value);
        result.push({ accountId: entry.id, field: 'comments', kind: 'unknown', dedupeKey: `${entry.id}:unknown:${hash}`, payload: { reason: 'malformed_comment', hash } });
        continue;
      }
      const value = parsed.data;
      result.push({ accountId: entry.id, field: 'comments', kind: 'comment', dedupeKey: `${entry.id}:comment:${value.id}`, payload: { id: value.id, text: value.text, from: value.from, media: value.media, timestamp: value.timestamp, entry_time: entry.time } });
    }
    for (const item of entry.messaging ?? []) {
      const m = message.safeParse(item);
      if (m.success) {
        const v = m.data;
        const command = ['SEND', 'HELP', 'STOP'].includes(normalize(v.message.text ?? '')) ? normalize(v.message.text ?? '') : 'other';
        result.push({ accountId: entry.id, field: 'messages', kind: 'message', dedupeKey: `${entry.id}:message:${v.message.mid}`, payload: { sender: v.sender, recipient: v.recipient, timestamp: v.timestamp, message: { mid: v.message.mid, command, is_echo: v.message.is_echo } } });
        continue;
      }
      const p = postback.safeParse(item);
      if (p.success) {
        const v = p.data;
        result.push({ accountId: entry.id, field: 'messaging_postbacks', kind: 'postback', dedupeKey: `${entry.id}:postback:${v.sender.id}:${v.timestamp}:${v.postback.payload}`, payload: v });
        continue;
      }
      const hash = digest(item);
      result.push({ accountId: entry.id, field: 'messaging', kind: 'unknown', dedupeKey: `${entry.id}:unknown:${hash}`, payload: { reason: 'malformed_messaging_event', hash } });
    }
  }
  return result;
}
export const commentEvent = comment;
export const messageEvent = message;
export const postbackEvent = postback;
