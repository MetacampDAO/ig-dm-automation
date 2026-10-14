'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { duplicateCampaign } from './actions';
export function DuplicateButton({id}:{id:string}) { const router=useRouter(); const [error,setError]=useState(''); return <><button type="button" onClick={async()=>{try{const result=await duplicateCampaign(id);router.push(`/admin/campaigns/${result.id}`);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}}}>Duplicate</button>{error&&<small role="alert">{error}</small>}</>; }
