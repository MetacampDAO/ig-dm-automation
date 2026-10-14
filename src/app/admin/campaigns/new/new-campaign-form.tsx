'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createCampaign } from '../actions';

export function NewCampaignForm({accountId}:{accountId:string}) {
  const router=useRouter();
  const [pending,start]=useTransition();
  const [name,setName]=useState('');
  const [post,setPost]=useState('');
  const [error,setError]=useState('');
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    start(async()=>{
      setError('');
      try {
        const form=new FormData(); form.set('account_id',accountId); form.set('name',name); form.set('post_link',post);
        const result=await createCampaign(form);
        if(!result.id) { setError(result.errors.name??Object.values(result.errors)[0]??'Check the name and try again.'); return; }
        const query=result.postError?`?post=${encodeURIComponent(result.postLink??post)}&postError=${encodeURIComponent(result.postError)}`:'';
        router.push(`/admin/campaigns/${result.id}${query}`); router.refresh();
      } catch(cause) { setError(cause instanceof Error?cause.message:'Could not create this campaign.'); }
    });
  }
  return <section><form className="new-campaign-form" onSubmit={submit} noValidate>
    <label>Name<input value={name} maxLength={120} required placeholder="e.g. September AI workshop" onChange={(event)=>setName(event.target.value)}/><small>A name your team will recognise in the campaign list.</small></label>
    <label>Instagram post or Reel link<input type="url" value={post} required placeholder="https://www.instagram.com/p/…/" onChange={(event)=>{setPost(event.target.value);setError('');}}/><small>Paste the link to the post where people will comment.</small></label>
    <button disabled={pending}>{pending?'Creating…':'Create campaign'}</button>
    {error&&<p role="alert">{error}</p>}
  </form></section>;
}
