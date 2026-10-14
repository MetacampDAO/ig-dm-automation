import { beforeEach, describe, expect, it, vi } from 'vitest';
import commentFixture from './fixtures/comment.json';
import ownFixture from './fixtures/own-comment.json';
import { MemoryRepository } from '../src/lib/memory-repository';
import type { Account, Campaign, StoredEvent } from '../src/lib/repository';
import { isCommentReply } from '../src/lib/repository';
import { splitEnvelope } from '../src/lib/events';
import { processEvent } from '../src/lib/flow';
import { dispatchAction, textRequest } from '../src/lib/actions';
import { MetaClient, MetaError, mockCalls, resetMetaMock, scriptMockCommentReply, scriptMockSend } from '../src/lib/meta/client';
import { validateCampaignCopy } from '../src/lib/copy';
import { exampleCampaignSeed } from '../src/lib/seed-data';
import { resetEnvForTests } from '../src/lib/env';

const campaignId = '11111111-1111-4111-8111-111111111111';
const replyText = 'Sent you a DM 📩 Check your inbox or message requests.';
let repo: MemoryRepository;
let campaign: Campaign;

beforeEach(() => {
  process.env.META_APP_ID = 'mock'; process.env.META_APP_SECRET = 'secret'; process.env.WEBHOOK_VERIFY_TOKEN = 'verify';
  process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder'; process.env.SUPABASE_ANON_KEY = 'placeholder';
  process.env.ADMIN_EMAILS = 'admin@example.com'; process.env.META_MOCK = '1';
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64'); process.env.OPTOUT_HASH_KEY = Buffer.alloc(32, 2).toString('base64');
  process.env.JOB_SECRET = 'test-job-secret-long-enough-123456'; process.env.APP_URL = 'https://app.example.com';
  resetEnvForTests(); resetMetaMock(); repo = new MemoryRepository();
  repo.accounts.push({ id: 'account-id', ig_user_id: 'ig-account', username: 'yourhandle', access_token_enc: null, token_obtained_at: null, token_expires_at: null, state: 'not_tested' } satisfies Account);
  campaign = { ...exampleCampaignSeed('account-id', 'media-1', null), id: campaignId, status: 'active', copy_approved: true, links_verified: true, comment_reply_text: replyText };
  repo.campaigns.push(campaign);
});

async function receive(fixture: unknown): Promise<StoredEvent[]> {
  const events: StoredEvent[] = [];
  for (const event of splitEnvelope(fixture)) {
    const row = await repo.insertEvent({ dedupe_key: event.dedupeKey, account_ig_user_id: event.accountId, field: event.field, kind: event.kind, payload: event.payload });
    if (row) { events.push(row); await processEvent(repo, row); }
  }
  return events;
}
function comment(id = 'comment-1', at = new Date(Date.now() - 2000).toISOString()) {
  const fixture = structuredClone(commentFixture);
  fixture.entry[0].changes[0].value.id = id;
  fixture.entry[0].changes[0].value.timestamp = at;
  return fixture;
}
function send() {
  return { entry: [{ id: 'ig-account', messaging: [{ sender: { id: 'user-1' }, recipient: { id: 'ig-account' }, timestamp: Date.now(), message: { mid: 'send-1', text: 'SEND' } }] }] };
}
function replies() { return repo.actions.filter((action) => action.kind === 'comment_reply'); }

describe('public comment reply', () => {
  it('sends one threaded reply after an accepted private DM and records the reply ID', async () => {
    await receive(comment());
    expect(repo.actions.map((action) => [action.kind, action.state])).toEqual([['private_reply', 'sent'], ['comment_reply', 'sent']]);
    expect(replies()[0].action_key).toBe('cr:comment-1');
    expect(replies()[0].provider_message_id).toBe('mock-reply-2');
    expect(replies()[0].request).toEqual({ comment_id: 'comment-1', message: replyText });
    expect(isCommentReply(replies()[0].request)).toBe(true);
    expect(mockCalls.map((call) => call.path)).toEqual(['/v25.0/ig-account/messages', '/v25.0/comment-1/replies']);
    expect(mockCalls[1]).toEqual({ method: 'POST', path: '/v25.0/comment-1/replies', body: { message: replyText } });
    expect(repo.conversations[0].stage).toBe('awaiting_interaction');
    expect(repo.conversations[0].private_reply_sent_at).toBeTruthy();
  });

  it.each([null, ''])('keeps public reply off for %s copy', async (value) => {
    campaign.comment_reply_text = value;
    await receive(comment());
    expect(replies()).toHaveLength(0);
    expect(repo.actions.map((action) => action.kind)).toEqual(['private_reply']);
    campaign.comment_reply_text = ' \t ';
    const whitespace = comment('whitespace'); whitespace.entry[0].changes[0].value.from.id = 'user-2';
    await receive(whitespace);
    expect(replies()).toHaveLength(0);
    expect(repo.actions.map((action) => action.kind)).toEqual(['private_reply', 'private_reply']);
  });

  it('does not reply after an expired or failed private DM', async () => {
    await receive(comment('expired', new Date(Date.now() - 8 * 86_400_000).toISOString()));
    expect(repo.actions[0].state).toBe('skipped');
    expect(repo.actions[0].error_code).toBe('private_reply_window_expired');
    expect(replies()).toHaveLength(0);
    scriptMockSend(403);
    const other = comment('denied'); other.entry[0].changes[0].value.from.id = 'user-2';
    await receive(other);
    expect(repo.actions.find((action) => action.action_key === 'pr:denied')?.state).toBe('failed');
    expect(replies()).toHaveLength(0);
  });

  it('does not enqueue a public reply when a 500 leaves the private reply uncertain', async () => {
    scriptMockSend(500);
    await receive(comment());
    expect(repo.actions.map((action) => [action.kind, action.state])).toEqual([['private_reply', 'uncertain']]);
    expect(replies()).toHaveLength(0);
    expect(mockCalls.map((call) => call.path)).toEqual(['/v25.0/ig-account/messages']);
  });

  it('waits for a 429 private reply retry to succeed before enqueueing one public reply', async () => {
    scriptMockSend(429, 'ok');
    await receive(comment());
    const privateReply = repo.actions[0];
    expect(privateReply.state).toBe('queued'); expect(privateReply.attempts).toBe(1);
    expect(replies()).toHaveLength(0);
    privateReply.due_at = new Date(Date.now() - 1000).toISOString();
    await dispatchAction(repo, privateReply.id);
    expect(privateReply.state).toBe('sent'); expect(privateReply.attempts).toBe(2);
    expect(replies()).toHaveLength(1); expect(replies()[0].state).toBe('sent');
    expect(mockCalls.map((call) => call.path)).toEqual(['/v25.0/ig-account/messages', '/v25.0/ig-account/messages', '/v25.0/comment-1/replies']);
  });

  it('deduplicates the webhook and action key', async () => {
    const [event] = await receive(comment());
    await receive(comment());
    await processEvent(repo, event);
    expect(replies()).toHaveLength(1);
    expect(mockCalls.filter((call) => call.path.endsWith('/replies'))).toHaveLength(1);
  });

  it('skips a second matching comment from the same person', async () => {
    await receive(comment()); await receive(comment('comment-2'));
    expect(repo.conversations).toHaveLength(1);
    expect(replies()).toHaveLength(1);
    expect(repo.actions.find((action) => action.error_code === 'already_opened')?.state).toBe('skipped');
  });

  it('also replies after a direct private DM', async () => {
    campaign.delivery_style = 'direct';
    await receive(comment());
    expect(replies()).toHaveLength(1);
    expect(replies()[0].state).toBe('sent');
    expect(repo.conversations[0].stage).toBe('delivered');
    expect(repo.conversations[0].fulfilled_at).toBeTruthy();
  });

  it('replies once after an opening button fails and the text fallback succeeds', async () => {
    campaign.opening_button_experiment = true;
    scriptMockSend(400, 'ok');
    await receive(comment());
    expect(repo.actions.filter((action) => action.kind === 'private_reply').map((action) => action.state)).toEqual(['failed']);
    expect(repo.actions.filter((action) => action.kind === 'private_reply_fallback').map((action) => action.state)).toEqual(['sent']);
    expect(replies()).toHaveLength(1);
    expect(replies()[0].state).toBe('sent');
    expect(replies()[0].action_key).toBe('cr:comment-1');
  });

  it('retries a 429 public reply without consuming the send mock queue', async () => {
    scriptMockSend('ok', 403); scriptMockCommentReply(429, 'ok');
    await receive(comment());
    const reply = replies()[0];
    expect(reply.state).toBe('queued'); expect(reply.attempts).toBe(1);
    expect(repo.conversations[0].stage).toBe('awaiting_interaction');
    reply.due_at = new Date(Date.now() - 1000).toISOString();
    await dispatchAction(repo, reply.id);
    expect(reply.state).toBe('sent'); expect(reply.attempts).toBe(2);
    const ordinary = await repo.insertAction({ action_key: 'later-send', conversation_id: repo.conversations[0].id, kind: 'delivery', request: textRequest({ id: 'user-1' }, 'later') });
    if (!ordinary) throw new Error('Missing ordinary action');
    repo.conversations[0].last_inbound_at = new Date().toISOString();
    await dispatchAction(repo, ordinary.id);
    expect(ordinary.state).toBe('failed'); expect(ordinary.error_code).toBe('403');
  });

  it.each([500, 'timeout'] as const)('retries %s public reply and sends after it becomes due', async (failure) => {
    scriptMockCommentReply(failure, 'ok');
    await receive(comment());
    const reply = replies()[0];
    expect(reply.state).toBe('queued');
    expect(new Date(reply.due_at).getTime()).toBeGreaterThan(Date.now());
    await dispatchAction(repo, reply.id);
    expect(reply.attempts).toBe(1);
    reply.due_at = new Date(Date.now() - 1000).toISOString();
    await dispatchAction(repo, reply.id);
    expect(reply.state).toBe('sent');
    expect(reply.attempts).toBe(2);
    expect(repo.conversations[0].stage).toBe('awaiting_interaction');
    await receive(send());
    expect(repo.conversations[0].stage).toBe('delivered');
    expect(repo.actions.filter((action) => action.kind === 'delivery' && action.state === 'sent')).toHaveLength(1);
  });

  it('marks a public reply uncertain after three consecutive 500s', async () => {
    scriptMockCommentReply(500, 500, 500);
    await receive(comment());
    const reply = replies()[0];
    for (let attempt = 1; attempt < 3; attempt++) {
      expect(reply.state).toBe('queued');
      expect(reply.attempts).toBe(attempt);
      reply.due_at = new Date(Date.now() - 1000).toISOString();
      await dispatchAction(repo, reply.id);
    }
    expect(reply.state).toBe('uncertain');
    expect(reply.attempts).toBe(3);
    expect(repo.audits.some((audit) => audit.action === 'uncertain_send' && audit.target === reply.id)).toBe(true);
  });

  it('marks a malformed public reply response uncertain immediately without retrying', async () => {
    const replyCall = vi.spyOn(MetaClient.prototype, 'replyToComment').mockRejectedValueOnce(new MetaError('malformed_comment_reply_response', 0));
    try {
      await receive(comment());
      const reply = replies()[0];
      expect(reply.state).toBe('uncertain');
      expect(reply.error_code).toBe('malformed_comment_reply_response');
      expect(reply.attempts).toBe(1);
      expect(repo.audits.some((audit) => audit.action === 'uncertain_send' && audit.target === reply.id && audit.detail.code === 'malformed_comment_reply_response')).toBe(true);
      await dispatchAction(repo, reply.id);
      expect(replyCall).toHaveBeenCalledTimes(1);
      expect(reply.attempts).toBe(1);
    } finally { replyCall.mockRestore(); }
  });

  it('fails a 403 public reply without changing the conversation', async () => {
    scriptMockCommentReply(403);
    await receive(comment());
    expect(replies()[0].state).toBe('failed'); expect(replies()[0].error_code).toBe('403');
    expect(repo.actions[0].state).toBe('sent');
    expect(repo.conversations[0].stage).toBe('awaiting_interaction');
  });

  it('flags a 190 public reply as requiring reconnection', async () => {
    scriptMockCommentReply(190);
    await receive(comment());
    expect(replies()[0].state).toBe('failed'); expect(replies()[0].error_code).toBe('190');
    expect(repo.accounts[0].state).toBe('reconnect_required');
    expect(repo.conversations[0].stage).toBe('awaiting_interaction');
  });

  it.each([
    ['global_pause', (r: MemoryRepository, c: Campaign) => { r.sendsEnabled = false; void c; }],
    ['campaign_inactive', (r: MemoryRepository, c: Campaign) => { c.status = 'paused'; void r; }],
    ['conversation_paused', (r: MemoryRepository, c: Campaign) => { r.conversations[0].paused = true; void c; }],
  ] as const)('skips public reply when %s applies after the DM', async (reason, pause) => {
    const insert = repo.insertAction.bind(repo);
    repo.insertAction = async (input) => { const row = await insert(input); if (input.kind === 'comment_reply') pause(repo, campaign); return row; };
    await receive(comment());
    expect(repo.actions[0].state).toBe('sent');
    expect(replies()[0].state).toBe('skipped'); expect(replies()[0].error_code).toBe(reason);
    expect(mockCalls.filter((call) => call.path.endsWith('/replies'))).toHaveLength(0);
  });

  it('ignores the account’s own comment webhook', async () => {
    await receive(ownFixture);
    expect(repo.conversations).toHaveLength(0); expect(repo.actions).toHaveLength(0); expect(mockCalls).toHaveLength(0);
  });

  it('validates public reply length and URLs while accepting off values', () => {
    expect(exampleCampaignSeed('account-id', 'media-1', null).comment_reply_text).toBeNull();
    expect(() => validateCampaignCopy(campaign)).not.toThrow();
    expect(() => validateCampaignCopy({ ...campaign, comment_reply_text: 'x'.repeat(301) })).toThrow(/Comment reply/);
    expect(() => validateCampaignCopy({ ...campaign, comment_reply_text: 'See http://example.com' })).toThrow(/Comment reply/);
    expect(() => validateCampaignCopy({ ...campaign, comment_reply_text: 'See https://example.com' })).toThrow(/Comment reply/);
    expect(() => validateCampaignCopy({ ...campaign, comment_reply_text: 'See HTTPS://example.com' })).toThrow(/Comment reply/);
    expect(() => validateCampaignCopy({ ...campaign, comment_reply_text: null })).not.toThrow();
    expect(() => validateCampaignCopy({ ...campaign, comment_reply_text: '' })).not.toThrow();
    expect(() => validateCampaignCopy({ ...campaign, comment_reply_text: ' \t ' })).not.toThrow();
  });
});
