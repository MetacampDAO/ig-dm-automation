import type { Campaign, CampaignCopyPatch, Repository } from './repository';
import { parseCampaignForm } from './campaign-form';
import { DatabaseError } from './database-error';
import { defaultFollowSendOpening, defaultSendOpening, profileUrl } from './campaign-fields';
import { env } from './env';

export function blankCopy(): CampaignCopyPatch { const username=env().IG_USERNAME; return {name:'',keywords:[],fuzzy:false,require_follow:false,delivery_style:'opening',opening_button_experiment:true,comment_reply_text:null,opening_text:defaultSendOpening,opening_button_text:'',follow_opening_text:defaultFollowSendOpening(username),follow_opening_button_text:'',opening_button_title:'',follow_opening_button_title:'',direct_text:'',comparison_text:'',comparison_sources:[],delivery_text:'',delivery_buttons:[],follow_prompt_text:'',follow_retry_text:'',follow_unknown_text:'',follow_profile_url:profileUrl(username)}; }

export function copyFromCampaign(c: Campaign): CampaignCopyPatch { return {name:c.name,keywords:c.keywords,fuzzy:c.fuzzy,require_follow:c.require_follow,delivery_style:c.delivery_style,opening_button_experiment:c.opening_button_experiment,comment_reply_text:c.comment_reply_text,opening_text:c.opening_text,opening_button_text:c.opening_button_text,follow_opening_text:c.follow_opening_text,follow_opening_button_text:c.follow_opening_button_text,opening_button_title:c.opening_button_title,follow_opening_button_title:c.follow_opening_button_title,direct_text:c.direct_text,comparison_text:c.comparison_text,comparison_sources:c.comparison_sources,delivery_text:c.delivery_text,delivery_buttons:c.delivery_buttons,follow_prompt_text:c.follow_prompt_text,follow_retry_text:c.follow_retry_text,follow_unknown_text:c.follow_unknown_text,follow_profile_url:c.follow_profile_url}; }
export async function saveCampaignCopy(repo: Repository, actor: string, accountId: string, id: string | null, input: unknown): Promise<{id?:string;errors:Record<string,string>}> {
  const parsed=parseCampaignForm(input); if(!parsed.data) return {errors:parsed.errors};
  if(id) { const old=await repo.getCampaign(id); if(!old) throw new Error('campaign not found'); if(old.account_id!==accountId) throw new Error('campaign account mismatch'); try { const result=await repo.updateCampaignCopy(id,parsed.data,actor); return {id:result.id,errors:{}}; } catch(error) { if(error instanceof DatabaseError&&error.code==='23505') return {errors:{name:'A campaign with this name already exists.'}}; throw error; } }
  const accounts=await repo.adminAccounts(); if(!accounts.some((a)=>a.id===accountId)) throw new Error('account not found');
  try { const result=await repo.createCampaign(accountId,parsed.data); await repo.audit(actor,'campaign_create',result.id,{fields:Object.keys(parsed.data)}); return {id:result.id,errors:{}}; } catch(error) { if(error instanceof DatabaseError&&error.code==='23505') return {errors:{name:'A campaign with this name already exists.'}}; throw error; }
}
export async function duplicateCampaignRecord(repo: Repository, id: string, actor: string): Promise<{id:string;name:string}> {
  const source=await repo.getCampaign(id); if(!source) throw new Error('campaign not found');
  const base=source.name.slice(0,110);
  for(let attempt=1;attempt<=20;attempt++) { const name=`${base} copy${attempt===1?'':` ${attempt}`}`; try { const result=await repo.createCampaign(source.account_id,{...copyFromCampaign(source),name}); await repo.audit(actor,'campaign_duplicate',result.id,{source:id,fields:Object.keys(copyFromCampaign(source))}); return {id:result.id,name}; } catch(error) { if(error instanceof DatabaseError&&error.code==='23505') continue; throw error; } }
  throw new Error('Could not choose a unique copy name after 20 attempts');
}
