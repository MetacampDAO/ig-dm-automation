'use server';

import { z } from 'zod';
import { forbidden } from 'next/navigation';
import { AdminAuthError, requireAdmin, requireRole } from '@/lib/admin';
import { campaignFormFromData, campaignFormSchema, postLinkSchema } from '@/lib/campaign-form';
import { blankCopy, duplicateCampaignRecord, saveCampaignCopy } from '@/lib/campaign-editor';
import { decryptToken } from '@/lib/crypto';
import { env } from '@/lib/env';
import { MetaClient, MetaError } from '@/lib/meta/client';
import { findOwnedPost, parsePostLink } from '@/lib/post-link';
import { SupabaseRepository } from '@/lib/supabase-repository';
import { DatabaseError } from '@/lib/database-error';
import type { Campaign, Repository } from '@/lib/repository';

async function guarded(role: 'editor'|'approver') { try { const admin=await requireAdmin(); await requireRole(role,admin); return admin; } catch(error) { if(error instanceof AdminAuthError&&error.status===403) forbidden(); throw error; } }
async function editor() { return guarded('editor'); }
async function approver() { return guarded('approver'); }
export async function saveCampaign(id: string | null, form: FormData): Promise<{id?:string;errors:Record<string,string>}> {
  const admin=await editor(); const repo=new SupabaseRepository();
  const accountId=id?(await repo.getCampaign(z.uuid().parse(id)))?.account_id:z.uuid().parse(form.get('account_id'));
  if(!accountId) throw new Error('campaign not found');
  return saveCampaignCopy(repo,admin.email,accountId,id,campaignFormFromData(form));
}
export async function createCampaign(form: FormData): Promise<{id?:string;errors:Record<string,string>;postError?:string;postLink?:string}> {
  const admin=await editor(); const repo=new SupabaseRepository();
  const accountId=z.uuid().parse(form.get('account_id'));
  const parsedName=campaignFormSchema.shape.name.safeParse(form.get('name'));
  if(!parsedName.success) return {errors:{name:parsedName.error.issues[0]?.message??'Enter a campaign name.'}};
  const name=parsedName.data;
  const rawPost=form.get('post_link');
  const parsedPost=postLinkSchema.safeParse(typeof rawPost==='string'?rawPost:'');
  if(!parsedPost.success) return {errors:{post_link:parsedPost.error.issues[0]?.message??'Paste a full Instagram post or Reel link'}};
  const postLink=parsedPost.data;
  const accounts=await repo.adminAccounts(); if(!accounts.some((account)=>account.id===accountId)) throw new Error('account not found');
  let id:string;
  try { const created=await repo.createCampaign(accountId,{...blankCopy(),name}); id=created.id; await repo.audit(admin.email,'campaign_create',id,{fields:Object.keys(blankCopy())}); }
  catch(error) { if(error instanceof DatabaseError&&error.code==='23505') return {errors:{name:'A campaign with this name already exists.'}}; throw error; }
  let resolved:Awaited<ReturnType<typeof resolveCampaignPost>>;
  try { resolved=await resolveCampaignPost(repo,id,postLink,admin.email); }
  catch { return {id,errors:{},postError:'Could not check this post. An approver should check the connection and logs.',postLink}; }
  return resolved.ok?{id,errors:{}}:{id,errors:{},postError:resolved.error,postLink};
}
export async function duplicateCampaign(id: string): Promise<{id:string;name:string}> { const admin=await editor(); return duplicateCampaignRecord(new SupabaseRepository(),z.uuid().parse(id),admin.email); }
async function resolveCampaignPost(repo: Repository,id: string,input: string,actor: string): Promise<{ok:true;permalink:string;captionLine:string}|{ok:false;error:string}> {
  try { parsePostLink(input); } catch(error) { if(error instanceof Error) return {ok:false,error:error.message}; throw error; }
  let campaign:Campaign|null=null;
  try {
    campaign=await repo.getCampaign(z.uuid().parse(id)); if(!campaign) throw new Error('campaign not found');
    if(campaign.status!=='draft'&&campaign.status!=='paused') throw new Error('Pause campaign before changing post');
    const account=await repo.getAccountById(campaign.account_id); if(!account) throw new Error('account not found');
    const token=account.access_token_enc?decryptToken(account.access_token_enc):env().META_MOCK==='1'?'mock':null;
    if(!token) throw new Error('Account token missing');
    const found=await findOwnedPost(new MetaClient(account.ig_user_id,token),input);
    const permalink=parsePostLink(found.media.permalink).permalink;
    await repo.setCampaignMedia(campaign.id,found.media.id,permalink,found.captionLine,actor);
    return {ok:true,permalink,captionLine:found.captionLine};
  } catch(error) {
    if(error instanceof Error&&/^Post not found /.test(error.message)) return {ok:false,error:error.message};
    if(error instanceof MetaError) {
      if(error.status===401||error.code==='190') { await repo.audit(actor,'post_resolve_token_invalid',id,{code:error.code}); if(campaign) await repo.markReconnectRequired(campaign.account_id); return {ok:false,error:'Instagram connection expired. An approver must reconnect the account (Setup → Connect account).'}; }
      if(error.status===0||error.status===429||error.status>=500) { await repo.audit(actor,'post_resolve_transient',id,{code:error.code}); return {ok:false,error:'Could not check this post right now. Try Resolve again.'}; }
    }
    await repo.audit(actor,'post_resolve_failed',id,{message:error instanceof Error?error.message:String(error)});
    throw error;
  }
}
export async function resolvePostLink(id: string, input: string): Promise<{ok:true;permalink:string;captionLine:string}|{ok:false;error:string}> {
  const admin=await editor(); return resolveCampaignPost(new SupabaseRepository(),id,input,admin.email);
}
export async function deleteCampaign(id: string): Promise<{ok:true}|{ok:false;error:string}> { const admin=await approver(); try { await new SupabaseRepository().deleteCampaignDraft(z.uuid().parse(id),admin.email); } catch(error) { if(error instanceof DatabaseError&&error.message.includes('campaign has conversations')) return {ok:false,error:'This draft has conversations and cannot be deleted.'}; throw error; } return {ok:true}; }
export async function archiveCampaign(id: string, confirmed: boolean): Promise<void> { const admin=await approver(); if(!confirmed) throw new Error('Confirm archiving with in-flight conversations'); const repo=new SupabaseRepository(); const campaign=await repo.getCampaign(z.uuid().parse(id)); if(!campaign) throw new Error('campaign not found'); await repo.setCampaignStatus(campaign.id,'archived',admin.email,campaign.revision); }
