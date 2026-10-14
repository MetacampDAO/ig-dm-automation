import { z } from 'zod';
import { env } from '../env';

export type Button = { type: 'web_url'; title: string; url: string } | { type: 'postback'; title: string; payload: string };
export type SendRequest = { recipient: { comment_id: string } | { id: string }; message: { text: string } | { attachment: { type: 'template'; payload: { template_type: 'button'; text: string; buttons: Button[] } } } };
export type MetaCall = { method: string; path: string; body?: SendRequest | { message: string } };
export type OwnedMedia = { id: string; permalink: string; caption?: string; timestamp?: string };
export const mockCalls: MetaCall[] = [];
const followResults: Array<boolean | 'error' | 'missing'> = [];
const sendResults: Array<'ok' | 429 | 400 | 403 | 500 | 190 | 'timeout'> = [];
const commentReplyResults: Array<'ok' | 429 | 400 | 403 | 500 | 190 | 'timeout'> = [];
const commentTimeResults: Array<'ok' | 'error'> = [];
const mediaResults: Array<{ data: OwnedMedia[]; paging?: { cursors?: { after?: string }; next?: string } } | 'error'> = [];
export function scriptMockFollow(...results: Array<boolean | 'error' | 'missing'>): void { followResults.push(...results); }
export function scriptMockSend(...results: Array<'ok' | 429 | 400 | 403 | 500 | 190 | 'timeout'>): void { sendResults.push(...results); }
export function scriptMockCommentReply(...results: Array<'ok' | 429 | 400 | 403 | 500 | 190 | 'timeout'>): void { commentReplyResults.push(...results); }
export function scriptMockCommentTime(...results: Array<'ok' | 'error'>): void { commentTimeResults.push(...results); }
export function scriptMockMedia(...results: Array<{ data: OwnedMedia[]; paging?: { cursors?: { after?: string }; next?: string } } | 'error'>): void { mediaResults.push(...results); }
export function resetMetaMock(): void { mockCalls.length = 0; followResults.length = 0; sendResults.length = 0; commentReplyResults.length = 0; commentTimeResults.length = 0; mediaResults.length = 0; }

export class MetaError extends Error {
  constructor(public code: string, public status: number, public retryAfter?: number) { super(`Meta request failed: ${code}`); }
}

const sendResponse = z.object({ recipient_id: z.string().optional(), message_id: z.string() });
const commentReplyResponse = z.object({ id: z.string() });
const followResponse = z.object({ is_user_follow_business: z.boolean().optional() });
const commentResponse = z.object({ timestamp: z.string() });
const mediaResponse = z.object({ data: z.array(z.object({id:z.string().min(1),permalink:z.string().min(1),caption:z.string().optional(),timestamp:z.string().optional()})),paging:z.object({cursors:z.object({after:z.string().optional()}).optional(),next:z.string().optional()}).optional() });
function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined;
}

export class MetaClient {
  constructor(private accountId: string, private token: string) {}
  private path(suffix: string): string { return `/${env().META_API_VERSION}/${suffix}`; }
  private async request(method: 'GET' | 'POST', path: string, body?: MetaCall['body']): Promise<unknown> {
    if (env().META_MOCK === '1') {
      mockCalls.push({ method, path, body });
      if (method === 'POST') {
        const reply = path.endsWith('/replies');
        const result = (reply ? commentReplyResults : sendResults).shift() ?? 'ok';
        if (result === 'timeout') throw new MetaError('timeout', 0);
        if (result !== 'ok') throw new MetaError(String(result), result === 190 ? 400 : result, result === 429 ? 2 : undefined);
        if (reply) return { id: `mock-reply-${mockCalls.length}` };
        return { recipient_id: body && 'recipient' in body && 'id' in body.recipient ? body.recipient.id : undefined, message_id: `mock-${mockCalls.length}` };
      }
      if (path.includes('?fields=timestamp')) { if (commentTimeResults.shift() === 'error') throw new MetaError('mock_comment_time_error', 403); return { timestamp: new Date().toISOString() }; }
      if (path.includes('/me/media?')) { const result=mediaResults.shift()??{data:[]}; if(result==='error') throw new MetaError('mock_media_error',403); return result; }
      const result = followResults.shift() ?? true;
      if (result === 'error') throw new MetaError('mock_follow_error', 403);
      return result === 'missing' ? {} : { is_user_follow_business: result };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`https://graph.instagram.com${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryAfter = retryAfterSeconds(response.headers.get('retry-after'));
        let code = `http_${response.status}`;
        try {
          const parsed = z.object({ error: z.object({ code: z.number().optional() }).optional() }).safeParse(await response.json());
          if (parsed.success && parsed.data.error?.code) code = String(parsed.data.error.code);
        } catch { console.error('Meta error response was not JSON', response.status); }
        throw new MetaError(code, response.status, retryAfter);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof MetaError) throw error;
      throw new MetaError(controller.signal.aborted ? 'timeout' : 'transport_uncertain', 0);
    } finally { clearTimeout(timeout); }
  }
  async send(body: SendRequest): Promise<{ messageId: string; recipientId?: string }> {
    const response = await this.request('POST', this.path(`${this.accountId}/messages`), body);
    const parsed = sendResponse.safeParse(response);
    if (!parsed.success) throw new MetaError('malformed_send_response', 0);
    const result = parsed.data;
    return { messageId: result.message_id, recipientId: result.recipient_id };
  }
  async replyToComment(commentId: string, message: string): Promise<{ replyId: string }> {
    const response = await this.request('POST', this.path(`${commentId}/replies`), { message });
    const parsed = commentReplyResponse.safeParse(response);
    if (!parsed.success) throw new MetaError('malformed_comment_reply_response', 0);
    return { replyId: parsed.data.id };
  }
  async follows(igsid: string): Promise<boolean | 'unknown'> {
    const result = followResponse.parse(await this.request('GET', this.path(`${igsid}?fields=is_user_follow_business`)));
    return result.is_user_follow_business ?? 'unknown';
  }
  async commentTime(commentId: string): Promise<string> {
    const result = commentResponse.parse(await this.request('GET', this.path(`${commentId}?fields=timestamp`)));
    return result.timestamp;
  }
  async listMedia(after?: string): Promise<{ data: OwnedMedia[]; after?: string }> {
    const query=new URLSearchParams({fields:'id,permalink,caption,timestamp',limit:'50'});
    if(after) query.set('after',after);
    const parsed=mediaResponse.parse(await this.request('GET',this.path(`me/media?${query.toString()}`)));
    let next=parsed.paging?.cursors?.after;
    if(!next&&parsed.paging?.next) { try { next=new URL(parsed.paging.next).searchParams.get('after')??undefined; } catch { throw new MetaError('malformed_media_paging',0); } }
    return {data:parsed.data,after:next};
  }
}
