import type { Campaign } from './repository';
import { extractUrls, validHttpsUrl } from './campaign-form';
import { copyFields } from './campaign-fields';
import { env } from './env';

function requiredDisclosure(): { url: URL; text: string } | null { const { REQUIRED_DISCLOSURE_URL: url, REQUIRED_DISCLOSURE_TEXT: text } = env(); return url && text ? { url: new URL(url), text } : null; }
const bareHost = (hostname: string): string => hostname.toLowerCase().replace(/^www\./, '');
const barePath = (pathname: string): string => pathname.replace(/\/$/, '').toLowerCase();
function referencesDisclosureUrl(value: string, target: URL): boolean { return extractUrls(value).some((raw)=>{ try { const url=new URL(raw.includes('://')?raw:`https://${raw}`); return bareHost(url.hostname)===bareHost(target.hostname) && barePath(url.pathname)===barePath(target.pathname); } catch { return false; } }); }
function outboundFields(c: Campaign): Array<(typeof copyFields)[number]> {
  if(c.delivery_style==='direct') return ['direct_text'];
  const opening=c.require_follow?c.opening_button_experiment?['follow_opening_button_text','follow_opening_text']:['follow_opening_text']:c.opening_button_experiment?['opening_button_text','opening_text']:['opening_text'];
  return [...opening,'comparison_text','delivery_text',...(c.require_follow?['follow_prompt_text','follow_retry_text','follow_unknown_text']:[])] as Array<(typeof copyFields)[number]>;
}
export function linksFoundInCopy(c: Campaign): string[] { return [...outboundFields(c).flatMap((field)=>extractUrls(c[field]??'')),...(c.delivery_style==='opening'?(c.delivery_buttons??[]).map((button)=>button.url):[]),...(c.require_follow?[c.follow_profile_url]:[])].filter(Boolean); }
export function factSources(c: Campaign): string[] { return c.comparison_sources??[]; }
export function campaignCopyIssues(c: Campaign): string[] {
  const issues:string[]=[];
  if(!c.media_id) issues.push('Set a post link before activation.');
  if(!c.keywords?.length) issues.push('Add at least one trigger word or phrase.');
  if(c.require_follow&&c.delivery_style!=='opening') issues.push('Choose a first DM that asks the person to respond before requiring a follow.');
  const reply=c.comment_reply_text?.trim();
  if(reply&&(reply.length>300||extractUrls(reply).length>0)) issues.push('Comment reply exceeds 300 characters or contains a URL.');
  const used=(c.delivery_style==='direct'?['direct_text']:c.require_follow?[c.opening_button_experiment?'follow_opening_button_text':'follow_opening_text','delivery_text','follow_prompt_text','follow_retry_text','follow_unknown_text']:[c.opening_button_experiment?'opening_button_text':'opening_text','delivery_text']) as Array<(typeof copyFields)[number]>;
  const labels:Record<(typeof copyFields)[number],string>={opening_text:'First DM message',opening_button_text:'First DM message',follow_opening_text:'First DM when a follow is required',follow_opening_button_text:'First DM when a follow is required',direct_text:'First DM message',comparison_text:'Optional extra message',delivery_text:'Message with links',follow_prompt_text:'Ask them to follow',follow_retry_text:'If they tap too early',follow_unknown_text:'If we cannot check the follow'};
  for(const field of used) if(!c[field]?.trim()) issues.push(`${labels[field]} is needed.`);
  if(c.delivery_style==='opening'&&c.opening_button_experiment) for(const field of c.require_follow?['opening_button_title','follow_opening_button_title'] as const:['opening_button_title'] as const) if(!c[field]?.trim()||c[field].length>20) issues.push(`${field==='opening_button_title'?'First DM button label':'Follow first DM button label'} must be 1–20 characters.`);
  for(const field of copyFields) { const value=c[field]??''; if(value.length>640||Buffer.byteLength(value,'utf8')>1000) issues.push(`${labels[field]} exceeds the message limit.`); if(/[<>]/.test(value)) issues.push(`${labels[field]} contains HTML brackets.`); for(const url of extractUrls(value)) if(!validHttpsUrl(url)) issues.push(`${labels[field]} contains an unsafe link.`); }
  if(c.require_follow&&c.delivery_style==='opening') {
    if(!/\bfollow\b/i.test(c.opening_button_experiment?c.follow_opening_button_text:c.follow_opening_text)) issues.push('The first DM must explain that a follow is required.');
    if(c.opening_button_experiment&&!/\bfollow\b/i.test(c.follow_opening_text)) issues.push('The text fallback must explain that a follow is required.');
  }
  if(c.delivery_style==='opening'&&(!c.delivery_buttons?.length||c.delivery_buttons.length>3)) issues.push('Add one to three link buttons.');
  for(const button of c.delivery_buttons??[]) { if(!validHttpsUrl(button.url)||button.title.length>20||!button.title) issues.push('Each link button needs a short label and a valid HTTPS link.'); }
  if(c.require_follow&&!validHttpsUrl(c.follow_profile_url)) issues.push('The profile link must use HTTPS.');
  for(const url of linksFoundInCopy(c)) if(!validHttpsUrl(url)) issues.push('A message or button contains an unsafe link.');
  const outbound=outboundFields(c).map((field)=>c[field]??'').join('\n')+'\n'+(c.delivery_style==='opening'?(c.delivery_buttons??[]).map((button)=>button.url).join('\n'):'')+'\n'+(c.require_follow?c.follow_profile_url??'':'');
  const disclosure=requiredDisclosure();
  if(disclosure&&referencesDisclosureUrl(outbound,disclosure.url)) { const target=c.delivery_style==='direct'?c.direct_text:c.delivery_text; if(!target?.includes(disclosure.text)) issues.push(disclosureIssue(disclosure.text)); }
  return [...new Set(issues)];
}
export function disclosureIssue(text: string): string { return `Add the required disclosure: "${text}"`; }
export function validateCampaignCopy(c: Campaign): void { const issues=campaignCopyIssues(c); if(issues.length) throw new Error(issues[0]); }
