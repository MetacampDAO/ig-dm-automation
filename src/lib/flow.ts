import { z } from 'zod';
import type { Campaign, Conversation, Repository, StoredEvent } from './repository';
import { commentEvent } from './events';
import { matchesKeyword } from './keyword';
import { buttonRequest, dispatchAction, queueAction, skipAction, textRequest } from './actions';
import { MetaClient } from './meta/client';
import { decryptToken } from './crypto';
import { env } from './env';

const inbound = z.object({ sender: z.object({ id: z.string() }), recipient: z.object({ id: z.string() }), timestamp: z.number(), message: z.object({ mid: z.string(), command: z.string(), is_echo: z.boolean().optional() }).optional(), postback: z.object({ payload: z.string() }).optional() });
const postbackPayload = /^cmp:([0-9a-f-]{36}):(send|followed|retry)$/;
const stages = ['opened','awaiting_interaction','interaction_received','follow_prompted','delivered','closed'];
export function canAdvance(current: string, next: string): boolean { return stages.indexOf(next) >= stages.indexOf(current) && stages.includes(next); }

function token(enc: string | null): string { if (enc) return decryptToken(enc); if (env().META_MOCK === '1') return 'mock'; throw new Error('Account token missing'); }
async function enqueueAndTry(repo: Repository, c: Conversation, key: string, kind: string, request: ReturnType<typeof textRequest>): Promise<void> {
  const row = await queueAction(repo, c, key, kind, request);
  if (row) await dispatchAction(repo, row.id);
}
async function deliver(repo: Repository, c: Conversation, campaign: Campaign): Promise<void> {
  if (!c.igsid || c.fulfilled_at) return;
  if (campaign.comparison_text.trim()) await enqueueAndTry(repo, c, `comparison:${c.id}`, 'comparison', textRequest({ id: c.igsid }, campaign.comparison_text));
  else await enqueueAndTry(repo, c, `links:${c.id}`, 'delivery', buttonRequest(c.igsid, campaign.delivery_text, campaign.delivery_buttons));
}
async function followCheck(repo: Repository, c: Conversation, campaign: Campaign, delayed = false): Promise<void> {
  if (!c.igsid || !c.consent_event_type) throw new Error('Follow check requires verified inbound IGSID');
  const account = await repo.getAccountById(campaign.account_id);
  if (!account) throw new Error('Account missing');
  let result: boolean | 'unknown';
  try { result = await new MetaClient(account.ig_user_id, token(account.access_token_enc)).follows(c.igsid); }
  catch (error) { result = 'unknown'; await repo.audit('system', 'follow_check_error', c.id, { message: error instanceof Error ? error.message : String(error) }); }
  const now = new Date().toISOString();
  const state = result === true ? 'true' : result === false ? 'false' : 'unknown';
  const current = await repo.advance(c.id, c.stage === 'follow_prompted' ? 'follow_prompted' : result === true ? 'interaction_received' : 'follow_prompted', { follow_state: state, follow_checked_at: now });
  if (result === true) { await deliver(repo, current, campaign); return; }
  if (!delayed) await repo.scheduleRecheck(c.id, new Date(Date.now() + 20_000).toISOString());
  if (delayed) return;
  const retry = c.stage === 'follow_prompted';
  const text = result === false ? retry ? campaign.follow_retry_text : campaign.follow_prompt_text : campaign.follow_unknown_text;
  const buttons = result === false && !retry ? [
    { type: 'web_url' as const, title: 'Open profile', url: campaign.follow_profile_url },
    { type: 'postback' as const, title: "I've followed", payload: `cmp:${campaign.id}:followed` },
  ] : [{ type: 'postback' as const, title: result === false ? 'Check again' : 'Try again', payload: `cmp:${campaign.id}:retry` }];
  await enqueueAndTry(repo, current, `follow:${c.id}:${now}`, 'follow_prompt', buttonRequest(c.igsid, text, buttons));
}
function providerTime(value: string | number): string {
  return new Date(typeof value === 'number' ? value < 1_000_000_000_000 ? value * 1000 : value : value).toISOString();
}
async function onComment(repo: Repository, event: StoredEvent): Promise<string | undefined> {
  const value = commentEvent.parse(event.payload);
  const account = await repo.getAccount(event.account_ig_user_id);
  if (!account) { await repo.audit('system', 'unknown_account', event.id, { account_ig_user_id: event.account_ig_user_id, media_id: value.media?.id ?? null, comment_id: value.id }); return 'unknown_account'; }
  if (value.from?.id === account.ig_user_id) return;
  const campaign = value.media?.id ? await repo.activeCampaign(account.id, value.media.id) : null;
  if (!campaign) return 'no_active_campaign';
  if (!matchesKeyword(value.text, campaign.keywords, campaign.fuzzy)) return;
  const textOpening = campaign.require_follow ? campaign.follow_opening_text : campaign.opening_text;
  const buttonOpening = campaign.require_follow ? campaign.follow_opening_button_text : campaign.opening_button_text;
  const request = campaign.delivery_style === 'direct' ? textRequest({ comment_id: value.id }, campaign.direct_text) : campaign.opening_button_experiment ? {
    recipient: { comment_id: value.id },
    message: { attachment: { type: 'template' as const, payload: { template_type: 'button' as const, text: buttonOpening, buttons: [{ type: 'postback' as const, title: campaign.require_follow ? campaign.follow_opening_button_title : campaign.opening_button_title, payload: `cmp:${campaign.id}:send` }] } } },
  } : textRequest({ comment_id: value.id }, textOpening);
  const existing = await repo.findByComment(campaign.id, value.id);
  if (existing) { if (!existing.private_reply_sent_at) await enqueueAndTry(repo, existing, `pr:${value.id}`, 'private_reply', request); else await skipAction(repo, existing, `skip:${event.dedupe_key}`, existing.fulfilled_at ? 'already_fulfilled' : 'already_opened'); return; }
  const others = value.from?.id ? await repo.findByIgsid(account.id, value.from.id) : [];
  if (value.from?.id && await repo.isOptedOut(account.id, value.from.id)) return;
  const sameCampaign = others.find((c) => c.campaign_id === campaign.id);
  if (sameCampaign) { await skipAction(repo, sameCampaign, `skip:${event.dedupe_key}`, sameCampaign.fulfilled_at ? 'already_fulfilled' : 'already_opened'); return; }
  let timestamp = value.timestamp;
  if (timestamp === undefined) {
    try { timestamp = await new MetaClient(account.ig_user_id, token(account.access_token_enc)).commentTime(value.id); }
    catch (error) { if (value.entry_time === undefined) throw error; timestamp = value.entry_time; }
  }
  const c = await repo.createConversation({ campaign_id: campaign.id, comment_id: value.id, comment_at: providerTime(timestamp), igsid: value.from?.id ?? null });
  await enqueueAndTry(repo, c, `pr:${value.id}`, 'private_reply', request);
}
async function onInbound(repo: Repository, event: StoredEvent): Promise<void> {
  const value = inbound.parse(event.payload);
  if (value.message?.is_echo || value.sender.id === event.account_ig_user_id || value.recipient.id !== event.account_ig_user_id) return;
  const account = await repo.getAccount(event.account_ig_user_id);
  if (!account) return;
  const all = await repo.findByIgsid(account.id, value.sender.id);
  const pending = all.filter((c) => !c.fulfilled_at && !c.opted_out && !c.paused && c.stage !== 'closed');
  const command = value.message?.command;
  if (command === 'STOP' || command === 'HELP') {
    if (command === 'STOP') await repo.optOut(account.id, value.sender.id);
    for (const c of all) await repo.advance(c.id, c.stage, command === 'STOP' ? { paused: true, opted_out: true } : { paused: true, needs_human: true });
    await repo.audit('system', command === 'STOP' ? 'opt_out' : 'human_handoff', value.sender.id, { account: account.id });
    return;
  }
  let c: Conversation | undefined;
  if (value.postback) {
    const match = postbackPayload.exec(value.postback.payload);
    if (!match) return;
    c = pending.find((candidate) => candidate.campaign_id === match[1]);
    if (!c) {
      const fulfilled = all.find((candidate) => candidate.campaign_id === match[1] && candidate.fulfilled_at);
      if (fulfilled) { await skipAction(repo, fulfilled, `skip:${event.dedupe_key}`, 'already_fulfilled'); return; }
    }
  } else if (command === 'SEND') {
    if (pending.length > 1) {
      pending.sort((a, b) => new Date(b.comment_at).getTime() - new Date(a.comment_at).getTime() || a.id.localeCompare(b.id));
      await repo.audit('system', 'multi_pending_send_choice', pending[0].id, { candidate_count: pending.length, candidate_ids: pending.map((candidate) => candidate.id), selected_comment_id: pending[0].comment_id, rule: 'newest_comment_at' });
    }
    c = pending[0];
  }
  if (!c) { if (command === 'SEND' || value.postback) await repo.saveUnmatched(event.id, event.account_ig_user_id, value.sender.id); return; }
  if (value.timestamp < new Date(c.comment_at).getTime()) return;
  const campaign = await repo.getCampaign(c.campaign_id);
  if (!campaign || campaign.status !== 'active') return;
  const at = new Date(value.timestamp).toISOString();
  c = await repo.advance(c.id, c.stage === 'follow_prompted' ? 'follow_prompted' : 'interaction_received', { last_inbound_at: at, consent_event_type: value.postback ? 'postback' : 'message' });
  await repo.deleteUnmatched(event.id);
  if (campaign.require_follow) await followCheck(repo, c, campaign);
  else await deliver(repo, c, campaign);
}
export async function processEvent(repo: Repository, event: StoredEvent): Promise<void> {
  let note: string | undefined;
  if (event.kind === 'comment') note = await onComment(repo, event);
  else if (event.kind === 'message' || event.kind === 'postback') await onInbound(repo, event);
  else throw new Error(`Unknown event kind ${event.kind}`);
  await repo.finishEvent(event.id);
  if (note) await repo.noteEvent(event.id, note);
}
export async function processRecheck(repo: Repository, conversationId: string): Promise<void> {
  const c = await repo.getConversation(conversationId);
  if (!c || c.fulfilled_at || c.paused || !c.last_inbound_at) return;
  const campaign = await repo.getCampaign(c.campaign_id);
  if (campaign?.status === 'active' && campaign.require_follow) await followCheck(repo, c, campaign, true);
}
