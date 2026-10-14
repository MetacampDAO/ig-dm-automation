import { isIP } from 'node:net';
import { z } from 'zod';
import { normalize } from './keyword';
import type { CampaignCopyPatch } from './repository';

import { copyFields } from './campaign-fields';
import { parsePostLink } from './post-link';
export const postLinkSchema=z.string().trim().min(1,'Paste a full Instagram post or Reel link').max(2048,'Instagram post link is too long. Paste a shorter link.').refine((value)=>{try{parsePostLink(value);return true;}catch{return false;}},'Paste a full Instagram post or Reel link');
export function validHttpsUrl(value: string): boolean { try { const url=new URL(value); return url.protocol==='https:' && !url.username && !url.password && !isIP(url.hostname) && url.hostname.includes('.') && !/[<>\s]/.test(value) && url.href.length<=2048; } catch { return false; } }
const bareDomainTlds = new Set(['com','sg','co','io','ai','org','net','gov','edu','me','ly','link','app','dev','xyz','info','biz','tv','gg','to']);
export function extractUrls(text: string): string[] { return [...text.matchAll(/(?<![a-z0-9@._/-])(?:[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?(?!\w))/gi)].map((match)=>match[0].replace(/[.,;!?)\]]+$/,'')).filter((token)=>token.includes('://')||token.toLowerCase().startsWith('www.')||bareDomainTlds.has(token.split('/')[0].split('.').at(-1)?.toLowerCase()??'')); }
const message=z.string().max(640).refine((value)=>Buffer.byteLength(value,'utf8')<=1000,'Must be at most 1000 bytes').refine((value)=>!/[<>]/.test(value),'HTML brackets are not allowed').refine((value)=>extractUrls(value).every(validHttpsUrl),'Copy contains an unsafe URL');
const title=z.string().max(20).refine((value)=>!/[<>]/.test(value)&&extractUrls(value).length===0,'Button titles cannot contain HTML or URLs');
const url=z.string().refine((value)=>value===''||validHttpsUrl(value),'Use an HTTPS URL without credentials or an IP address');
export const campaignFormSchema=z.strictObject({
  name:z.string().trim().min(1).max(120).refine((value)=>!/[<>]/.test(value),'HTML brackets are not allowed'),
  keywords:z.array(z.string().trim().max(60)).min(1).max(20).transform((values)=>values.map((value)=>normalize(value))).refine((values)=>values.every((value)=>value.length>=2),'Each keyword needs at least two normalized characters').refine((values)=>new Set(values).size===values.length,'Keywords must be distinct after normalization'),
  fuzzy:z.boolean(),require_follow:z.boolean(),delivery_style:z.enum(['direct','opening']),opening_button_experiment:z.boolean(),
  opening_text:message,opening_button_text:message,follow_opening_text:message,follow_opening_button_text:message,
  opening_button_title:title,follow_opening_button_title:title,direct_text:message,comparison_text:message,
  comparison_sources:z.array(url).max(20),delivery_text:message,
  delivery_buttons:z.array(z.strictObject({type:z.literal('web_url'),title:title.min(1),url:url.refine(Boolean,'URL required')})).max(3),
  follow_prompt_text:message,follow_retry_text:message,follow_unknown_text:message,follow_profile_url:url,
  comment_reply_text:z.string().trim().max(300).refine((value)=>!/[<>]/.test(value)&&extractUrls(value).length===0,'Public reply cannot contain HTML or URLs').nullable().transform((value)=>value||null),
}).refine((value)=>!value.require_follow||value.delivery_style==='opening',{path:['delivery_style'],message:'Follow required campaigns must use opening delivery'});
export type CampaignForm = z.infer<typeof campaignFormSchema>;
const one=(form: FormData,key: string)=>{const value=form.get(key);if(value===null)return '';if(typeof value!=='string')throw new Error(`Invalid ${key} form field`);return value;};
export function campaignFormFromData(form: FormData): unknown {
  const keywords=one(form,'keywords').split(/\r?\n/).map((v)=>v.trim()).filter(Boolean);
  const comparison_sources=one(form,'comparison_sources').split(/\r?\n/).map((v)=>v.trim()).filter(Boolean);
  const delivery_buttons=Array.from({length:3},(_,i)=>({type:'web_url' as const,title:one(form,`button_${i}_title`).trim(),url:one(form,`button_${i}_url`).trim()})).filter((button)=>button.title||button.url);
  return {name:one(form,'name'),keywords,fuzzy:form.get('fuzzy')==='on',require_follow:form.get('require_follow')==='on',delivery_style:one(form,'delivery_style'),opening_button_experiment:form.get('opening_button_experiment')==='on',...Object.fromEntries(copyFields.map((field)=>[field,one(form,field)])),opening_button_title:one(form,'opening_button_title'),follow_opening_button_title:one(form,'follow_opening_button_title'),comparison_sources,delivery_buttons,follow_profile_url:one(form,'follow_profile_url'),comment_reply_text:one(form,'comment_reply_text').trim()||null};
}
export function parseCampaignForm(input: unknown): { data?: CampaignCopyPatch; errors: Record<string,string> } { const parsed=campaignFormSchema.safeParse(input); if(parsed.success) return {data:parsed.data,errors:{}}; const errors:Record<string,string>={}; for(const issue of parsed.error.issues){ const key=String(issue.path[0]??'form'); errors[key]??=issue.message; } return {errors}; }
