import { randomUUID } from 'node:crypto';
import { isCommentReply, type Action, type Campaign, type Conversation, type Repository } from './repository';
import { messageAllowed, privateReplyAllowed } from './windows';
import { decryptToken } from './crypto';
import { env } from './env';
import { defaultFollowSendOpening, defaultSendOpening } from './campaign-fields';
import { MetaClient, MetaError, type SendRequest } from './meta/client';

export function textRequest(recipient: { comment_id: string } | { id: string }, text: string): SendRequest { return { recipient, message: { text } }; }
export function buttonRequest(igsid: string, text: string, buttons: Campaign['delivery_buttons'] | Array<{ type: 'postback'; title: string; payload: string } | { type: 'web_url'; title: string; url: string }>): SendRequest {
  if (text.length > 640 || buttons.length < 1 || buttons.length > 3) throw new Error('Button template limits exceeded');
  return { recipient: { id: igsid }, message: { attachment: { type: 'template', payload: { template_type: 'button', text, buttons } } } };
}
export async function queueAction(repo: Repository, conversation: Conversation, key: string, kind: string, request: Action['request']): Promise<Action | null> {
  return repo.insertAction({ action_key: key, conversation_id: conversation.id, kind, request });
}
export async function skipAction(repo: Repository, conversation: Conversation, key: string, reason: string): Promise<void> {
  await repo.insertAction({ action_key: key, conversation_id: conversation.id, kind: 'skip', request: textRequest({ id: conversation.igsid ?? 'unknown' }, ''), state: 'skipped', error_code: reason });
}
function allowed(kind: string, c: Conversation, now: Date): string | null {
  if (kind === 'comment_reply') return null;
  if (kind === 'private_reply' || kind === 'private_reply_fallback') return privateReplyAllowed(c.comment_at, now) ? null : 'private_reply_window_expired';
  return messageAllowed(c.last_inbound_at, now) ? null : 'messaging_window_expired';
}
export async function dispatchAction(repo: Repository, id: string, owner = randomUUID(), now = new Date()): Promise<void> {
  const action = await repo.claim(id, owner);
  if (!action) return;
  const conversation = await repo.getConversation(action.conversation_id);
  if (!conversation) throw new Error(`Missing conversation ${action.conversation_id}`);
  const campaign = await repo.getCampaign(conversation.campaign_id);
  if (!campaign) throw new Error(`Missing campaign ${conversation.campaign_id}`);
  const account = await repo.getAccountById(campaign.account_id);
  if (!account) throw new Error(`Missing account ${campaign.account_id}`);
  const reason = campaign.status !== 'active' ? 'campaign_inactive' : conversation.paused || conversation.opted_out || conversation.igsid && await repo.isOptedOut(account.id, conversation.igsid) ? 'conversation_paused' : !(await repo.globalSendsEnabled()) ? 'global_pause' : allowed(action.kind, conversation, now);
  if (reason) { await repo.updateAction(action.id, { state: 'skipped', error_code: reason, lease_until: null }); return; }
  const token = account.access_token_enc ? decryptToken(account.access_token_enc) : env().META_MOCK === '1' ? 'mock' : null;
  if (!token) throw new Error('Account token missing');
  const meta = new MetaClient(account.ig_user_id, token);
  let commentReply: Action | null = null;
  try {
    let sent: { messageId: string; recipientId?: string };
    if (action.kind === 'comment_reply') {
      if (!isCommentReply(action.request)) throw new Error('Comment reply action has invalid request');
      const reply = await meta.replyToComment(action.request.comment_id, action.request.message);
      sent = { messageId: reply.replyId };
    } else {
      if (isCommentReply(action.request)) throw new Error('Message action has invalid request');
      sent = await meta.send(action.request);
    }
    await repo.updateAction(action.id, { state: 'sent', provider_message_id: sent.messageId, sent_at: now.toISOString(), lease_until: null });
    if (action.kind === 'private_reply' || action.kind === 'private_reply_fallback') {
      if (sent.recipientId && conversation.igsid && sent.recipientId !== conversation.igsid) await repo.audit('system', 'recipient_id_mismatch', conversation.id, { from_comment: conversation.igsid, from_reply: sent.recipientId });
      const stage = campaign.delivery_style === 'direct' ? 'delivered' : 'awaiting_interaction';
      await repo.advance(conversation.id, stage, { igsid: sent.recipientId ?? conversation.igsid, private_reply_sent_at: now.toISOString(), ...(stage === 'delivered' ? { fulfilled_at: now.toISOString() } : {}) });
      const commentReplyText = campaign.comment_reply_text?.trim();
      if (commentReplyText) commentReply = await queueAction(repo, conversation, `cr:${conversation.comment_id}`, 'comment_reply', { comment_id: conversation.comment_id, message: commentReplyText });
    }
    if (action.kind === 'comparison') {
      const latest = await repo.getConversation(conversation.id);
      if (!latest?.igsid) throw new Error('Missing IGSID after comparison');
      const links = await queueAction(repo, latest, `links:${conversation.id}`, 'delivery', buttonRequest(latest.igsid, campaign.delivery_text, campaign.delivery_buttons));
      if (links) await dispatchAction(repo, links.id, owner, now);
    }
    if (action.kind === 'delivery') await repo.advance(conversation.id, 'delivered', { fulfilled_at: now.toISOString() });
  } catch (error) {
    if (!(error instanceof MetaError)) throw error;
    if (error.code !== 'malformed_comment_reply_response' && (error.status === 429 || action.kind === 'comment_reply' && (error.status >= 500 || error.status === 0)) && action.attempts < 3) {
      const delay = Math.max(error.retryAfter ?? 0, [2, 8, 30][Math.min(action.attempts - 1, 2)]);
      await repo.updateAction(action.id, { state: 'queued', due_at: new Date(now.getTime() + delay * 1000).toISOString(), error_code: error.code, lease_until: null });
    } else if (error.status >= 500 || error.status === 0) {
      await repo.updateAction(action.id, { state: 'uncertain', error_code: error.code, lease_until: null });
      await repo.audit('system', 'uncertain_send', action.id, { code: error.code });
    } else if (action.kind === 'private_reply' && campaign.opening_button_experiment && error.code !== '190' && error.status >= 400 && error.status < 500) {
      await repo.updateAction(action.id, { state: 'failed', error_code: error.code, lease_until: null });
      await repo.audit('system', 'opening_button_fallback', action.id, { code: error.code });
      const fallbackText=campaign.require_follow?campaign.follow_opening_text.trim()||defaultFollowSendOpening(env().IG_USERNAME):campaign.opening_text.trim()||defaultSendOpening;
      const fallback = await queueAction(repo, conversation, `pr:${conversation.comment_id}:fallback`, 'private_reply_fallback', textRequest({ comment_id: conversation.comment_id }, fallbackText));
      if (fallback) await dispatchAction(repo, fallback.id, owner, now);
    } else {
      await repo.updateAction(action.id, { state: 'failed', error_code: error.code, lease_until: null });
      if (error.status === 401 || error.code.includes('190')) await repo.markReconnectRequired(account.id);
    }
  }
  if (commentReply) await dispatchAction(repo, commentReply.id, owner, now);
}
