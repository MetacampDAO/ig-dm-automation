import { createElement } from 'react';

export const copyFields = ['opening_text','opening_button_text','follow_opening_text','follow_opening_button_text','direct_text','comparison_text','delivery_text','follow_prompt_text','follow_retry_text','follow_unknown_text'] as const;
export const defaultSendOpening='Reply SEND to get the links.';
export const defaultFollowSendOpening=(username:string)=>`Follow @${username}, then reply SEND to continue.`;
export const profileUrl=(username:string)=>`https://www.instagram.com/${username}/`;

export const activityLabels:Record<string,string>={private_reply:'First DM',private_reply_fallback:'First DM (text fallback)',comparison:'Extra message',delivery:'Links message',comment_reply:'Public reply',follow_prompt:'Follow prompt',skip:'Skipped',copy_approved:'Read every message ticked',links_verified:'Links tapped ticked',campaign_active:'Activated',campaign_paused:'Paused',campaign_archived:'Archived',campaign_post:'Post set',campaign_edit:'Edited',campaign_edit_fields:'Edited',campaign_created:'Created',campaign_create:'Created',campaign_duplicated:'Duplicated',campaign_duplicate:'Duplicated',post_resolve_transient:'Post lookup: Instagram temporarily unavailable',post_resolve_token_invalid:'Post lookup: Instagram connection expired',post_resolve_failed:'Post lookup failed',opening_button_fallback:'Button refused, text sent instead',uncertain_send:'Send outcome unknown',recipient_id_mismatch:'Recipient mismatch',follow_check_error:'Follow check error',multi_pending_send_choice:'Several open conversations, newest chosen',human_handoff:'Handed to a human (HELP)',opt_out:'Opted out (STOP)',unknown_account:'Unknown account',event_retry_failed:'Background retry failed',action_job_failed:'Background retry failed',recheck_job_failed:'Background retry failed',unmatched_replay_failed:'Background retry failed'};
export function activityLabel(value:string):string|null { return activityLabels[value]??null; }
export const stateLabels:Record<string,string>={opened:'Opened',awaiting_interaction:'Waiting for their reply',interaction_received:'They replied',follow_prompted:'Asked to follow',delivered:'Delivered',closed:'Closed',queued:'Queued',sending:'Sending',sent:'Sent',failed:'Failed',uncertain:'Unknown',skipped:'Skipped'};
export const errorLabels:Record<string,string>={private_reply_window_expired:'Too late to reply (7 days)',messaging_window_expired:'Too late to message (24 h)',campaign_inactive:'Campaign not active',conversation_paused:'Conversation paused',global_pause:'All sends paused',already_opened:'Already messaged',already_fulfilled:'Already delivered',send_lease_expired:'Send timed out',timeout:'Instagram timeout',transport_uncertain:'Network error',malformed_send_response:'Unexpected Instagram reply',malformed_comment_reply_response:'Unexpected Instagram reply',http_429:'Rate limited, retrying','429':'Rate limited, retrying'};
export function stateLabel(value:string):string|null { return stateLabels[value]??null; }
export function errorLabel(value:string):string|null { return errorLabels[value]??(/^\d+$/.test(value)?`Instagram error ${value}`:null); }
export function displayActivityValue(value:string|null,kind:'event'|'state'|'error') {
  if(value===null) return '—';
  const label=kind==='event'?activityLabel(value):kind==='state'?stateLabel(value):errorLabel(value);
  return label??createElement('code',null,value);
}
export function campaignModeLabel(c:{delivery_style:'direct'|'opening';opening_button_experiment:boolean}):string { return c.delivery_style==='direct'?'One DM':c.opening_button_experiment?'Button first':'Reply SEND'; }
