'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { CampaignCopyPatch } from '@/lib/repository';
import { copyFields, defaultFollowSendOpening, defaultSendOpening, profileUrl } from '@/lib/campaign-fields';
import { archiveCampaign, deleteCampaign, duplicateCampaign, resolvePostLink, saveCampaign } from './actions';

type CopyKey=(typeof copyFields)[number];
type Mode='direct'|'button'|'send';
const modeOf=(value:CampaignCopyPatch):Mode=>value.delivery_style==='direct'?'direct':value.opening_button_experiment?'button':'send';

export function CampaignForm({igUsername,initial,id,accountId,editable,role,mediaPermalink,mediaCaption,status,unfulfilled,initialPost='',initialPostError=''}:{igUsername:string;initial:CampaignCopyPatch;id:string|null;accountId:string;editable:boolean;role:'editor'|'approver';mediaPermalink:string|null;mediaCaption:string|null;status:'new'|'draft'|'active'|'paused'|'archived';unfulfilled:number;initialPost?:string;initialPostError?:string}) {
  const router=useRouter(); const [pending,start]=useTransition(); const [value,setValue]=useState(initial);
  const [keywords,setKeywords]=useState(initial.keywords.join('\n')); const [sources,setSources]=useState(initial.comparison_sources.join('\n'));
  const [post,setPost]=useState(initialPost); const [postError,setPostError]=useState(initialPostError);
  const [resolved,setResolved]=useState(mediaPermalink); const [caption,setCaption]=useState(mediaCaption??'');
  const [errors,setErrors]=useState<Record<string,string>>({}); const [message,setMessage]=useState(''); const [confirmed,setConfirmed]=useState(false);
  const [extraOpen,setExtraOpen]=useState(false); const [fallbackOpen,setFallbackOpen]=useState(false); const [followOpen,setFollowOpen]=useState(initial.require_follow); const [errorSummary,setErrorSummary]=useState('');
  const mode=modeOf(value); const buttons=value.delivery_buttons;
  const change=<K extends keyof CampaignCopyPatch>(key:K,next:CampaignCopyPatch[K])=>setValue((old)=>({...old,[key]:next}));
  const run=(task:()=>Promise<void>)=>start(async()=>{setMessage('');try{await task();}catch(error){setMessage(error instanceof Error?error.message:String(error));}});
  const selectMode=(next:Mode)=>setValue((old)=>({...old,delivery_style:next==='direct'?'direct':'opening',opening_button_experiment:next==='button',require_follow:next==='direct'?false:old.require_follow}));
  const textField=(key:CopyKey,label:string,help:string)=>{const shown=mode==='button'&&key==='opening_text'?value[key]||defaultSendOpening:mode==='button'&&key==='follow_opening_text'?value[key]||defaultFollowSendOpening(igUsername):value[key];return <label className="editor-field" key={key}><strong>{label}</strong><textarea value={shown} maxLength={640} disabled={!editable} onChange={(event)=>change(key,event.target.value)}/><small>{help} {shown.length}/640 characters · {new TextEncoder().encode(shown).length}/1000 bytes.</small>{errors[key]&&<span role="alert">{errors[key]}</span>}</label>;};
  function submit() { run(async()=>{const form=new FormData(); form.set('account_id',accountId); form.set('name',value.name); form.set('keywords',keywords); form.set('comparison_sources',sources); form.set('delivery_style',value.delivery_style);
    for(const field of copyFields) form.set(field,field==='opening_text'&&mode!=='send'&&!value.opening_text.trim()?defaultSendOpening:field==='follow_opening_text'&&mode!=='send'&&!value.follow_opening_text.trim()?defaultFollowSendOpening(igUsername):value[field]);
    for(const key of ['opening_button_title','follow_opening_button_title','follow_profile_url'] as const) form.set(key,value[key]);
    form.set('comment_reply_text',value.comment_reply_text??''); for(const key of ['fuzzy','require_follow','opening_button_experiment'] as const) if(value[key]) form.set(key,'on');
    buttons.forEach((button,i)=>{form.set(`button_${i}_title`,button.title);form.set(`button_${i}_url`,button.url);});
    const result=await saveCampaign(id,form); setErrors(result.errors);
    const failed=Object.keys(result.errors);
    const visible=new Set(['name','keywords','comment_reply_text',...(mode==='direct'?['direct_text']:mode==='button'?['opening_button_text','opening_button_title','delivery_text','delivery_buttons']:['opening_text','delivery_text','delivery_buttons']),...(extraOpen?['comparison_text','comparison_sources']:[]),...(fallbackOpen&&mode==='button'?[value.require_follow?'follow_opening_text':'opening_text']:[]),...(followOpen&&value.require_follow?[mode==='button'?'follow_opening_button_text':'follow_opening_text','follow_prompt_text','follow_retry_text','follow_unknown_text','follow_profile_url',...(mode==='button'?['follow_opening_button_title']:[])]:[])]);
    const labels:Record<string,string>={name:'Campaign name',keywords:'Words that trigger the DM',opening_text:'Text fallback',opening_button_text:'First DM message',opening_button_title:'Button label',follow_opening_text:'Follow text fallback',follow_opening_button_text:'First DM when a follow is required',follow_opening_button_title:'Follow button label',direct_text:'First DM message',comparison_text:'Extra message',comparison_sources:'Where you checked these facts',delivery_text:'Message with links',delivery_buttons:'Link buttons',follow_prompt_text:'Ask them to follow',follow_retry_text:'If they tap too early',follow_unknown_text:'If we cannot check the follow',follow_profile_url:'Profile link',comment_reply_text:'Public reply',delivery_style:'First DM mode'};
    setErrorSummary(failed.length&&failed.every((key)=>!visible.has(key))?`Fix these before saving: ${failed.map((key)=>labels[key]??key).join(', ')}`:'');
    if(failed.some((key)=>key==='comparison_text'||key==='comparison_sources')) setExtraOpen(true);
    if(failed.some((key)=>key==='opening_text'||key==='follow_opening_text')&&mode==='button') setFallbackOpen(true);
    if(failed.some((key)=>key.startsWith('follow_'))) setFollowOpen(true);
    if(result.id){setMessage('Saved. An approver must review these changes before activation.');router.refresh();}
  }); }
  return <>
    {!editable&&<section><p>This campaign is read only. Pause it to edit the messages or post.</p></section>}
    {errorSummary&&<p role="alert">{errorSummary}</p>}
    <section className="editor-grid"><div>
      <div className="editor-step"><h2>1. Post</h2><p>The campaign watches comments on this Instagram post or Reel.</p>
        {resolved?<p><a href={resolved} target="_blank" rel="noreferrer">{resolved}</a>{caption&&<> · {caption}</>}</p>:<p>No post found yet.</p>}
        <label className="editor-field"><strong>Change post</strong><input type="url" value={post} disabled={!editable} placeholder="https://www.instagram.com/p/…/" onChange={(event)=>{setPost(event.target.value);setPostError('');}}/><small>Paste the link to a post or Reel owned by @{igUsername}.</small></label>
        {editable&&<button type="button" disabled={pending||!post.trim()} onClick={()=>run(async()=>{if(!id)throw new Error('Campaign missing');const result=await resolvePostLink(id,post);if(!result.ok){setPostError(result.error);router.replace(`/admin/campaigns/${id}?post=${encodeURIComponent(post)}&postError=${encodeURIComponent(result.error)}`);return;}setResolved(result.permalink);setCaption(result.captionLine);setPost('');setPostError('');router.replace(`/admin/campaigns/${id}`);router.refresh();})}>Resolve</button>}
        {postError&&<p role="alert">{postError}</p>}
      </div>
      <div className="editor-step"><h2>2. Trigger</h2><p>These words in a comment start the DM.</p>
        <label className="editor-field"><strong>Words that trigger the DM</strong><textarea value={keywords} disabled={!editable} placeholder="e.g. GUIDE" onChange={(event)=>setKeywords(event.target.value)}/><small>Enter one word or phrase per line; matching ignores case and punctuation.</small>{errors.keywords&&<span role="alert">{errors.keywords}</span>}</label>
        <label className="editor-field"><input type="checkbox" checked={value.fuzzy} disabled={!editable} onChange={(event)=>change('fuzzy',event.target.checked)}/> Allow small typos<small>Also match close spellings; check examples before activation.</small></label>
      </div>
      <div className="editor-step"><h2>3. First DM</h2><p>This private message is sent in reply to their comment.</p>
        {value.require_follow&&<p>While a follow is required, the first DM written in step 6 is sent instead.</p>}
        <fieldset disabled={!editable}><legend>How should the first DM work?</legend>
          <label><input type="radio" name="first-dm-mode" checked={mode==='direct'} onChange={()=>selectMode('direct')}/> Send everything in one DM<small>The full message goes out immediately after their comment.</small></label>
          <label><input type="radio" name="first-dm-mode" checked={mode==='button'} onChange={()=>selectMode('button')}/> Ask them to tap a button first<small>They get the links after tapping the button. This is the default.</small></label>
          <label><input type="radio" name="first-dm-mode" checked={mode==='send'} onChange={()=>selectMode('send')}/> Ask them to reply SEND<small>They get the links after replying SEND in the chat.</small></label>
        </fieldset>
        {mode==='direct'&&textField('direct_text','Message','Include everything they need in this one DM.')}
        {mode==='button'&&<>{textField('opening_button_text','Message','Introduce what they will receive when they tap the button.')}
          <label className="editor-field"><strong>Button label</strong><input value={value.opening_button_title} maxLength={20} disabled={!editable} onChange={(event)=>change('opening_button_title',event.target.value)}/><small>Keep this short; Instagram allows up to 20 characters.</small>{errors.opening_button_title&&<span role="alert">{errors.opening_button_title}</span>}</label>
          <details open={fallbackOpen} onToggle={(event)=>setFallbackOpen(event.currentTarget.open)}><summary>If Instagram refuses the button, this text is sent instead</summary>{textField(value.require_follow?'follow_opening_text':'opening_text','Text fallback','Ask the person to reply SEND if the button cannot be sent.')}</details></>}
        {mode==='send'&&textField('opening_text','Message','Tell the person to reply SEND to receive the links.')}
      </div>
      {mode!=='direct'&&<div className="editor-step"><h2>4. After they respond</h2><p>Send the links after they tap the button or reply SEND.</p>
        {textField('delivery_text','Message with links','Explain what the buttons open and include any required disclosure here.')}
        <fieldset disabled={!editable}><legend>Link buttons</legend><small>Add one to three buttons, each with a short label and an HTTPS link.</small>
          {buttons.map((button,i)=><div className="button-row" key={i}><label>Button {i+1} label<input aria-label={`Button ${i+1} label`} value={button.title} maxLength={20} onChange={(event)=>change('delivery_buttons',buttons.map((item,j)=>j===i?{...item,title:event.target.value}:item))}/><small>What the person taps; 20 characters maximum.</small></label><label>HTTPS link<input aria-label={`Button ${i+1} link`} type="url" value={button.url} onChange={(event)=>change('delivery_buttons',buttons.map((item,j)=>j===i?{...item,url:event.target.value}:item))}/><small>The page this button opens.</small></label><button type="button" onClick={()=>change('delivery_buttons',buttons.filter((_,j)=>j!==i))}>Remove</button></div>)}
          {buttons.length<3&&<button type="button" onClick={()=>change('delivery_buttons',[...buttons,{type:'web_url',title:'',url:''}])}>Add link button</button>}
        </fieldset>{errors.delivery_buttons&&<p role="alert">{errors.delivery_buttons}</p>}
        <details open={extraOpen} onToggle={(event)=>setExtraOpen(event.currentTarget.open)}><summary>Optional extra message sent first</summary><p>Use this for a longer explanation, e.g. a price breakdown. Leave empty to skip.</p>
          {textField('comparison_text','Extra message','This message goes before the links message when it has text.')}
          <label className="editor-field"><strong>Where you checked these facts (optional links)</strong><textarea value={sources} disabled={!editable} onChange={(event)=>setSources(event.target.value)}/><small>Paste HTTPS source links, one per line, for the approver to check.</small>{errors.comparison_sources&&<span role="alert">{errors.comparison_sources}</span>}</label>
        </details>
      </div>}
      <div className="editor-step"><h2>5. Public reply under their comment</h2><p>This is visible to everyone on the post and can be left empty.</p>
        <label className="editor-field"><strong>Public reply (optional)</strong><textarea value={value.comment_reply_text??''} maxLength={300} disabled={!editable} onChange={(event)=>change('comment_reply_text',event.target.value||null)}/><small>Posted publicly after the DM is confirmed sent. Leave empty for none. {(value.comment_reply_text??'').length}/300 characters.</small>{errors.comment_reply_text&&<span role="alert">{errors.comment_reply_text}</span>}</label>
      </div>
      <div className="editor-step"><details open={followOpen} onToggle={(event)=>{const opened=event.currentTarget.open;setFollowOpen(opened);if(opened&&status==='draft'&&!value.follow_profile_url.trim())change('follow_profile_url',profileUrl(igUsername));}}><summary><strong>6. Require a follow first</strong></summary><p>Ask the person to follow @{igUsername} before sending the links.</p>
        <label className="editor-field"><input type="checkbox" checked={value.require_follow} disabled={!editable} onChange={(event)=>setValue((old)=>({...old,require_follow:event.target.checked,delivery_style:event.target.checked?'opening':old.delivery_style,opening_button_experiment:event.target.checked&&mode==='direct'?true:old.opening_button_experiment}))}/> Require a follow<small>When on, the links are held until Instagram confirms the follow.</small></label>
        {value.require_follow&&<>
          {textField(mode==='button'?'follow_opening_button_text':'follow_opening_text','First DM when a follow is required','Tell them they need to follow before receiving the links.')}
          {mode==='button'&&<label className="editor-field"><strong>Button label</strong><input value={value.follow_opening_button_title} maxLength={20} disabled={!editable} onChange={(event)=>change('follow_opening_button_title',event.target.value)}/><small>The button on the follow message; 20 characters maximum.</small>{errors.follow_opening_button_title&&<span role="alert">{errors.follow_opening_button_title}</span>}</label>}
          {textField('follow_prompt_text','Ask them to follow','Sent if Instagram says they are not following yet.')}
          {textField('follow_retry_text',"If they tap ‘I've followed’ too early",'Sent when a fresh check still shows they are not following.')}
          {textField('follow_unknown_text',"If we can't check the follow",'Sent if Instagram does not return a clear follow result.')}
          <label className="editor-field"><strong>Profile link</strong><input type="url" value={value.follow_profile_url} disabled={!editable} placeholder={profileUrl(igUsername)} onChange={(event)=>change('follow_profile_url',event.target.value)}/><small>Opens your Instagram profile when they tap Open profile.</small>{errors.follow_profile_url&&<span role="alert">{errors.follow_profile_url}</span>}</label>
        </>}
      </details></div>
      <div className="editor-step"><label className="editor-field"><strong>Campaign name</strong><input value={value.name} maxLength={120} disabled={!editable} onChange={(event)=>change('name',event.target.value)}/><small>The name your team sees in the campaign list.</small>{errors.name&&<span role="alert">{errors.name}</span>}</label>
        {editable&&<button type="button" disabled={pending} onClick={submit}>{pending?'Saving…':'Save changes'}</button>}{message&&<p role="status">{message}</p>}
      </div>
    </div><aside><h2>Preview</h2><p>Layout approximation; verify on a phone.</p><div className="preview">
      {mode==='direct'?<article><strong>First DM</strong><p>{value.direct_text||'Message empty'}</p></article>:<>
        <article><strong>First DM</strong><p>{(value.require_follow?mode==='button'?value.follow_opening_button_text:value.follow_opening_text:mode==='button'?value.opening_button_text:value.opening_text)||'Message empty'}</p>{mode==='button'&&<button disabled>{(value.require_follow?value.follow_opening_button_title:value.opening_button_title)||'Button label'}</button>}</article>
        {mode==='button'&&<article><strong>Text fallback if Instagram refuses the button</strong><p>{(value.require_follow?value.follow_opening_text||defaultFollowSendOpening(igUsername):value.opening_text||defaultSendOpening)}</p></article>}
        <p>Waits for the person to {mode==='button'?'tap the button or reply SEND':'reply SEND'}.</p>
        {value.require_follow&&<><article><strong>Not following</strong><p>{value.follow_prompt_text}</p><button disabled>Open profile</button> <button disabled>I&apos;ve followed</button></article><article><strong>Still not following</strong><p>{value.follow_retry_text}</p><button disabled>Check again</button></article><article><strong>Follow status unknown</strong><p>{value.follow_unknown_text}</p><button disabled>Try again</button></article></>}
        {value.comparison_text.trim()&&<article><strong>Extra message</strong><p>{value.comparison_text}</p></article>}
        <article><strong>Links</strong><p>{value.delivery_text||'Links message empty'}</p>{buttons.map((button,i)=><button key={i} disabled>{button.title||'Untitled button'}</button>)}</article>
      </>}
      <article><strong>Public reply</strong><p>{value.comment_reply_text||'off'}</p><small>Posted only after the DM is accepted.</small></article>
    </div></aside></section>
    {id&&<section><h2>More actions</h2><button type="button" disabled={pending} onClick={()=>run(async()=>{const result=await duplicateCampaign(id);router.push(`/admin/campaigns/${result.id}`);router.refresh();})}>Duplicate</button>{role==='approver'&&<>{status==='draft'&&<button type="button" disabled={pending} onClick={()=>run(async()=>{const result=await deleteCampaign(id);if(!result.ok){setMessage(result.error);return;}router.push('/admin');router.refresh();})}>Delete draft</button>}{(status==='draft'||status==='paused')&&<><label><input type="checkbox" checked={confirmed} onChange={(event)=>setConfirmed(event.target.checked)}/> Confirm archive with {unfulfilled} unfinished conversations</label><button type="button" disabled={pending||!confirmed} onClick={()=>run(async()=>{await archiveCampaign(id,confirmed);router.refresh();})}>Archive</button></>}</>}</section>}
  </>;
}
