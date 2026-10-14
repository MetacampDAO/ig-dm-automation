import { randomUUID } from 'node:crypto';
import type { Account, Action, ActionInput, AdminRole, Campaign, CampaignActivity, CampaignCopyPatch, ConnectionHealth, Conversation, ConversationPatch, Repository, Stage, StoredEvent } from './repository';
import { optOutDigest } from './optout';
import { DatabaseError } from './database-error';
import type { SeedRecord, TokenRecord, SetupAccount } from './setup-store';

const order: Stage[] = ['opened','awaiting_interaction','interaction_received','follow_prompted','delivered','closed'];
export class MemoryRepository implements Repository {
  accounts: Account[] = [];
  campaigns: Campaign[] = [];
  adminRoles: Array<{ email: string; role: AdminRole }> = [];
  events: StoredEvent[] = [];
  conversations: Conversation[] = [];
  actions: Action[] = [];
  audits: Array<{ actor: string; action: string; target: string; detail: Record<string, unknown> }> = [];
  unmatched: string[] = [];
  optouts: string[] = [];
  rechecks: Array<{ id: string; due: string; claimed: boolean }> = [];
  sendsEnabled = true;
  envelopes: unknown[] = [];
  async upsertAccount(record: TokenRecord): Promise<void> {
    const existing = this.accounts.find((account) => account.ig_user_id === record.ig_user_id);
    if (existing) Object.assign(existing, record);
    else this.accounts.push({ ...record, id: randomUUID() });
  }
  async listAccounts(): Promise<SetupAccount[]> { return this.accounts.map(({ id, username, access_token_enc }) => ({ id, username, access_token_enc })); }
  async insertCampaignIfAbsent(record: SeedRecord): Promise<{ id: string; created: boolean }> {
    const existing = this.campaigns.find((campaign) => campaign.account_id === record.account_id && campaign.name === record.name);
    if (existing) return { id: existing.id, created: false };
    const id = randomUUID();
    this.campaigns.push({ ...record, id });
    return { id, created: true };
  }
  async insertEvent(v: Pick<StoredEvent, 'dedupe_key' | 'account_ig_user_id' | 'field' | 'kind' | 'payload'>) { if (this.events.some((e) => e.dedupe_key === v.dedupe_key)) return null; const row = { ...v, id: randomUUID(), received_at: new Date().toISOString(), processed_at: null, process_error: null, process_attempts: 0, process_lease_until: null }; this.events.push(row); return row; }
  async getEvent(id: string) { return this.events.find((e) => e.id === id) ?? null; }
  async claimEvent(id: string) { const e=this.events.find((v)=>v.id===id); if(!e || e.processed_at || e.process_attempts>=3 || e.process_lease_until && new Date(e.process_lease_until).getTime()>Date.now()) return null; e.process_lease_until=new Date(Date.now()+60_000).toISOString(); return { ...e }; }
  async finishEvent(id: string, error?: string) { const e = this.events.find((v) => v.id === id); if (!e) throw new Error('Event missing'); e.processed_at = error ? null : new Date().toISOString(); e.process_error=error ?? null; e.process_attempts++; e.process_lease_until=null; }
  async noteEvent(id: string, note: string) { const e=this.events.find((v)=>v.id===id); if(!e) throw new Error('Event missing'); e.process_error=note; }
  async dueEvents() { return this.events.filter((e)=>!e.processed_at && e.process_attempts<3 && new Date(e.received_at).getTime()<Date.now()-30_000).slice(0,5); }
  async getAccount(igId: string) { return this.accounts.find((a) => a.ig_user_id === igId) ?? null; }
  async getAccountById(id: string) { return this.accounts.find((a) => a.id === id) ?? null; }
  async markReconnectRequired(id: string) { const a = this.accounts.find((v) => v.id === id); if (!a) throw new Error('Account missing'); a.state = 'reconnect_required'; }
  async activeCampaign(accountId: string, mediaId: string) { return this.campaigns.find((c) => c.account_id === accountId && c.media_id === mediaId && c.status === 'active') ?? null; }
  async getCampaign(id: string) { return this.campaigns.find((c) => c.id === id) ?? null; }
  async adminRoleState(email: string) { const bootstrap=this.adminRoles.length===0; return { role: bootstrap ? 'approver' as const : this.adminRoles.find((r)=>r.email===email.toLowerCase())?.role ?? 'editor' as const, bootstrap }; }
  async adminAccounts() { return this.accounts; }
  async listCampaigns(showArchived: boolean) { return this.campaigns.filter((c)=>showArchived || c.status!=='archived'); }
  async createCampaign(accountId: string, patch: CampaignCopyPatch) { if (this.campaigns.some((c)=>c.account_id===accountId && c.name===patch.name)) throw new DatabaseError({message:'campaign name already exists',code:'23505'}); const row: Campaign={ ...patch,id:randomUUID(),account_id:accountId,media_id:null,media_permalink:null,media_caption_line:null,copy_approved:false,links_verified:false,comparison_checked_at:null,revision:1,approved_revision:null,status:'draft' }; this.campaigns.push(row); return row; }
  async updateCampaignCopy(id: string, patch: CampaignCopyPatch, actor: string) { const c=await this.getCampaign(id); if(!c) throw new Error('campaign not found'); if(c.status!=='draft'&&c.status!=='paused') throw new Error('pause campaign before editing'); if(this.campaigns.some((other)=>other.id!==id&&other.account_id===c.account_id&&other.name===patch.name)) throw new DatabaseError({message:'campaign name already exists',code:'23505'}); const fields=Object.keys(patch).filter((key)=>JSON.stringify(c[key as keyof Campaign])!==JSON.stringify(patch[key as keyof CampaignCopyPatch])); Object.assign(c,patch,{revision:c.revision+1,copy_approved:false,links_verified:false,comparison_checked_at:null,approved_revision:null}); await this.audit(actor,'campaign_edit',id,{fields}); return c; }
  async setCampaignMedia(id: string, mediaId: string, permalink: string, captionLine: string, actor: string) { const c=await this.getCampaign(id); if(!c) throw new Error('campaign not found'); if(c.status!=='draft'&&c.status!=='paused') throw new Error('pause campaign before changing post'); Object.assign(c,{media_id:mediaId,media_permalink:permalink,media_caption_line:captionLine.slice(0,80),revision:c.revision+1,copy_approved:false,links_verified:false,comparison_checked_at:null,approved_revision:null}); await this.audit(actor,'campaign_post',id,{fields:['media_id','media_permalink']}); return c; }
  async setCampaignReview(id: string, field: 'copy_approved' | 'links_verified', value: boolean, actor: string, expectedRevision: number) { const c=await this.getCampaign(id); if(!c) throw new Error('campaign not found'); if(c.revision!==expectedRevision) throw new DatabaseError({message:'campaign changed since you loaded it',code:'P0001'}); if(c.status!=='draft'&&c.status!=='paused') throw new Error('campaign cannot be reviewed in this status'); c[field]=value; if(field==='copy_approved') c.comparison_checked_at=value?new Date().toISOString():null; c.approved_revision=c.copy_approved&&c.links_verified?c.revision:null; await this.audit(actor,field,id,{value}); }
  async setCampaignStatus(id: string, status: 'active' | 'paused' | 'archived', actor: string, expectedRevision: number) { const c=await this.getCampaign(id); if(!c) throw new Error('campaign not found'); if(c.revision!==expectedRevision) throw new DatabaseError({message:'campaign changed since you loaded it',code:'P0001'}); if(!((['draft','paused'].includes(c.status)&&status==='active')||(c.status==='active'&&status==='paused')||(['draft','paused'].includes(c.status)&&status==='archived'))) throw new Error('invalid campaign status transition'); if(status==='active'&&(!c.copy_approved||!c.links_verified||c.approved_revision!==c.revision||!c.comparison_checked_at||!c.media_id)) throw new DatabaseError({message:'campaign review or media ID missing',code:'P0001'}); if(status==='active'&&this.campaigns.some((other)=>other.id!==id&&other.account_id===c.account_id&&other.media_id===c.media_id&&other.status==='active')) throw new DatabaseError({message:'another active campaign uses this post',code:'23505'}); const old=c.status; c.status=status; await this.audit(actor,`campaign_${status}`,id,{from:old}); }
  async deleteCampaignDraft(id: string, actor: string) { const c=await this.getCampaign(id); if(!c) throw new Error('campaign not found'); if(c.status!=='draft') throw new Error('only drafts can be deleted'); if(this.conversations.some((v)=>v.campaign_id===id)) throw new Error('campaign has conversations'); this.campaigns=this.campaigns.filter((v)=>v.id!==id); await this.audit(actor,'campaign_delete',id,{}); }
  async campaignActivity(id: string): Promise<CampaignActivity[]> { const conversations=this.conversations.filter((c)=>c.campaign_id===id); const ids=new Set(conversations.map((c)=>c.id)); const rows: CampaignActivity[]=[...conversations.map((c)=>({at:c.comment_at,type:'conversation' as const,label:`Comment ${c.comment_id}; ${c.fulfilled_at?'fulfilled':'open'}`,igsid:c.igsid,state:c.stage,error_code:null})),...this.actions.filter((a)=>ids.has(a.conversation_id)).map((a)=>({at:a.sent_at??a.due_at,type:'action' as const,label:a.kind,igsid:conversations.find((c)=>c.id===a.conversation_id)?.igsid??null,state:a.state,error_code:a.error_code})),...this.audits.filter((a)=>a.target===id||ids.has(a.target)||this.actions.some((v)=>ids.has(v.conversation_id)&&v.id===a.target)).map((a)=>({at:new Date().toISOString(),type:'audit' as const,label:a.action,igsid:null,state:null,error_code:null}))]; return rows.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,100); }
  async unfulfilledCount(id: string) { return this.conversations.filter((c)=>c.campaign_id===id&&!c.fulfilled_at).length; }
  async connectionHealth(): Promise<ConnectionHealth> { const last=this.actions.filter((a)=>a.state==='failed'||a.state==='uncertain').at(-1); return {last_webhook_at:this.events.at(-1)?.received_at??null,last_sent_at:this.actions.filter((a)=>a.sent_at).at(-1)?.sent_at??null,last_error:last?{at:last.sent_at??last.due_at,state:last.state,error_code:last.error_code}:null,job_runner_active:null}; }
  async findByComment(campaignId: string, commentId: string) { return this.conversations.find((c) => c.campaign_id === campaignId && c.comment_id === commentId) ?? null; }
  async findByIgsid(accountId: string, igsid: string) { return this.conversations.filter((c) => c.igsid === igsid && this.campaigns.some((cp) => cp.id === c.campaign_id && cp.account_id === accountId)); }
  async createConversation(v: Pick<Conversation, 'campaign_id' | 'comment_id' | 'comment_at' | 'igsid'>) {
    const old = await this.findByComment(v.campaign_id, v.comment_id); if (old) return old;
    const row: Conversation = { ...v, id: randomUUID(), private_reply_sent_at: null, last_inbound_at: null, consent_event_type: null, stage: 'opened', follow_state: 'unknown', follow_checked_at: null, fulfilled_at: null, paused: false, needs_human: false, opted_out: false };
    this.conversations.push(row); return row;
  }
  async advance(id: string, stage: Stage, patch: ConversationPatch = {}) { const c = this.conversations.find((v) => v.id === id); if (!c) throw new Error('Conversation missing'); if (order.indexOf(stage) < order.indexOf(c.stage)) throw new Error('Backward stage'); Object.assign(c, patch, { stage }); return c; }
  async getConversation(id: string) { return this.conversations.find((c) => c.id === id) ?? null; }
  async insertAction(v: ActionInput): Promise<Action | null> { if (this.actions.some((a) => a.action_key === v.action_key)) return null; const row: Action = { ...v, id: randomUUID(), state: v.state ?? 'queued', provider_message_id: null, error_code: v.error_code ?? null, attempts: 0, due_at: v.due_at ?? new Date().toISOString(), lease_until: null, sent_at: null }; this.actions.push(row); return row; }
  async claim(id: string, owner: string) { const a = this.actions.find((v) => v.id === id); if (!a || new Date(a.due_at).getTime() > Date.now() || !(a.state === 'queued' || a.state === 'sending' && !!a.lease_until && new Date(a.lease_until).getTime() < Date.now())) return null; a.state = 'sending'; a.lease_until = new Date(Date.now() + 60_000).toISOString(); a.attempts++; void owner; return { ...a }; }
  async updateAction(id: string, patch: Partial<Action>) { const a = this.actions.find((v) => v.id === id); if (!a) throw new Error('Action missing'); Object.assign(a, patch); }
  async dueActions(limit: number) { return this.actions.filter((a) => a.state==='queued' && new Date(a.due_at).getTime() <= Date.now()).slice(0, limit); }
  async reconcileExpiredSends() { const expired=this.actions.filter((a)=>a.state==='sending' && !!a.lease_until && new Date(a.lease_until).getTime()<Date.now()); for(const a of expired){a.state='uncertain';a.error_code='send_lease_expired';a.lease_until=null;await this.audit('system','uncertain_send',a.id,{code:'send_lease_expired'});} return expired.length; }
  async globalSendsEnabled() { return this.sendsEnabled; }
  async audit(actor: string, action: string, target: string, detail: Record<string, unknown> = {}) { this.audits.push({ actor, action, target, detail }); }
  async saveUnmatched(eventId: string) { if (!this.unmatched.includes(eventId)) this.unmatched.push(eventId); }
  async isOptedOut(accountId: string, igsid: string) { return this.optouts.includes(optOutDigest(accountId, igsid)); }
  async optOut(accountId: string, igsid: string) { const key=optOutDigest(accountId, igsid); if (!this.optouts.includes(key)) this.optouts.push(key); }
  async dueUnmatched() { return this.unmatched.map((id) => this.events.find((e) => e.id === id)).filter((e): e is StoredEvent => !!e); }
  async deleteUnmatched(eventId: string) { this.unmatched = this.unmatched.filter((id) => id !== eventId); }
  async scheduleRecheck(conversationId: string, dueAt: string) { this.rechecks = this.rechecks.filter((r) => r.id !== conversationId); this.rechecks.push({ id: conversationId, due: dueAt, claimed: false }); }
  async dueRechecks() { return this.rechecks.filter((r) => !r.claimed && new Date(r.due).getTime() <= Date.now()).map((r) => r.id); }
  async claimRecheck(conversationId: string) { const row=this.rechecks.find((r)=>r.id===conversationId && !r.claimed && new Date(r.due).getTime()<=Date.now()); if(!row) return false; row.claimed=true; return true; }
  rateLimits = new Map<string, { windowStart: number; count: number; blocked: number }>();
  async rateLimitHit(key: string, route: string, limit: number, windowSeconds: number) { const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds * 1000; const id = `${key}|${route}|${windowStart}`; const row = this.rateLimits.get(id) ?? { windowStart, count: 0, blocked: 0 }; row.count++; if (row.count > limit) row.blocked++; this.rateLimits.set(id, row); return { allowed: row.count <= limit, count: row.count }; }
  async rateLimitBlockedLastHour() { let total = 0; for (const row of this.rateLimits.values()) if (row.windowStart >= Date.now() - 3_600_000) total += row.blocked; return total; }
  async purge() { for (const [id, row] of this.rateLimits) if (row.windowStart < Date.now() - 2 * 3_600_000) this.rateLimits.delete(id); }
  async debugEnvelope(v: unknown) { this.envelopes.push(v); }
}
