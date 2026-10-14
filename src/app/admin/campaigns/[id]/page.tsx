import React from 'react';
import Link from 'next/link';
import { forbidden, notFound, redirect } from 'next/navigation';
import { AdminAuthError, maskIgsid, requireAdmin, requireRole } from '@/lib/admin';
import { copyFromCampaign } from '@/lib/campaign-editor';
import { displayActivityValue } from '@/lib/campaign-fields';
import { campaignCopyIssues, factSources, linksFoundInCopy } from '@/lib/copy';
import { env } from '@/lib/env';
import { normalize } from '@/lib/keyword';
import { postNotFoundMessage } from '@/lib/post-link';
import { SupabaseRepository } from '@/lib/supabase-repository';
import { z } from 'zod';
import { setCampaignReview, setCampaignStatus } from '../../actions';
import { CampaignForm } from '../form';

export const dynamic='force-dynamic';
export default async function CampaignPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{error?:string;post?:string;postError?:string}>}) {
  let admin; try { admin=await requireAdmin(); } catch(error) { if(error instanceof AdminAuthError){if(error.status===401)redirect('/admin/login');forbidden();} throw error; }
  const repo=new SupabaseRepository(); const role=await requireRole('editor',admin,repo); const parsed=z.uuid().safeParse((await params)?.id); if(!parsed.success) notFound(); const id=parsed.data; const campaign=await repo.getCampaign(id); if(!campaign) notFound();
  const [activity,unfulfilled]=await Promise.all([repo.campaignActivity(id),repo.unfulfilledCount(id)]);
  const issues=campaignCopyIssues(campaign); if(campaign.copy_approved&&campaign.links_verified&&campaign.approved_revision!==campaign.revision) issues.push('These checks are for older messages. Review the current messages again.');
  const broad=campaign.keywords.filter((keyword)=>keyword.split(' ').length===1&&normalize(keyword).length<=4);
  const query=await searchParams; const error=query.error;
  const postErrors=new Set(['Paste a full Instagram post or Reel HTTPS link.','Paste an instagram.com/p/ or /reel/ HTTPS link.',postNotFoundMessage(),'Could not check this post right now. Try Resolve again.','Instagram connection expired. An approver must reconnect the account (Setup → Connect account).','Could not check this post. An approver should check the connection and logs.']);
  const next=campaign.status==='draft'?'Draft: fill in the steps below, then an approver ticks both boxes and activates.':campaign.status==='paused'?'Paused: make your changes, then an approver reviews both boxes and activates.':campaign.status==='active'?'Active: new matching comments start this DM flow. Pause before making changes.':'Archived: this campaign is kept for history.';
  return <main><header><h1>{campaign.name}</h1><Link href="/admin">Back to campaigns</Link></header>
    <section className="campaign-status"><h2><span className="status-badge">{campaign.status}</span> What happens next</h2><p>{next}</p>{error&&<p role="alert">{error==='stale'?'Campaign changed since you loaded it. Review the current messages and try again.':error==='copy-invalid'?'Fix the outstanding items before review or activation.':error==='media-conflict'?'Another active campaign uses this post.':'Both review boxes must be ticked before activation.'}</p>}
      <h3>Outstanding before activation</h3>{issues.length?<ul>{issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul>:<p>Nothing outstanding in the messages. The approver still needs to read them and test the links.</p>}{(broad.length>0||campaign.fuzzy)&&<p role="alert">Broad trigger: check sample comments for {broad.join(', ')}{campaign.fuzzy?' and small typo matching':''}.</p>}
      {role.role==='approver'&&campaign.status!=='archived'&&<><p>Both must be ticked by an approver before Activate.</p>{(campaign.status==='draft'||campaign.status==='paused')&&<div className="review-controls">{(['copy_approved','links_verified'] as const).map((field)=><form key={field} action={setCampaignReview}><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={campaign.revision}/><input type="hidden" name="field" value={field}/><input type="hidden" name="value" value={String(!campaign[field])}/><button>{field==='copy_approved'?"I've read every message":"I've tapped every link on a phone"}: {campaign[field]?'✓':'□'}</button></form>)}</div>}
        {campaign.status==='active'?<form action={setCampaignStatus}><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={campaign.revision}/><input type="hidden" name="status" value="paused"/><button>Pause</button></form>:campaign.status==='draft'||campaign.status==='paused'?<form action={setCampaignStatus}><input type="hidden" name="id" value={id}/><input type="hidden" name="revision" value={campaign.revision}/><input type="hidden" name="status" value="active"/><button disabled={issues.length>0||!campaign.copy_approved||!campaign.links_verified||campaign.approved_revision!==campaign.revision}>Activate</button></form>:null}</>}
    </section>
    <section><h2>Links to check</h2><p>Open each destination on a phone before ticking the link review box.</p><ul>{linksFoundInCopy(campaign).map((url,i)=><li key={i}>{url}</li>)}</ul>{!linksFoundInCopy(campaign).length&&<p>No links yet.</p>}</section>
    <section><h2>Fact sources (not sent)</h2><ul>{factSources(campaign).map((url,i)=><li key={i}>{url}</li>)}</ul>{!factSources(campaign).length&&<p>No fact sources yet.</p>}</section>
    <CampaignForm igUsername={env().IG_USERNAME} initial={copyFromCampaign(campaign)} id={id} accountId={campaign.account_id} editable={campaign.status==='draft'||campaign.status==='paused'} role={role.role} mediaPermalink={campaign.media_permalink} mediaCaption={campaign.media_caption_line} status={campaign.status} unfulfilled={unfulfilled} initialPost={query.post?.slice(0,2048)} initialPostError={postErrors.has(query.postError??'')?query.postError:undefined}/>
    <section><h2>Activity · last 100</h2><p>Actions marked sent were accepted by Instagram; delivery or read status is not inferred.</p><table><thead><tr><th>Time</th><th>Type</th><th>Event</th><th>Person</th><th>State</th><th>Error</th></tr></thead><tbody>{activity.map((row,i)=><tr key={i}><td>{row.at}</td><td>{row.type}</td><td>{displayActivityValue(row.label,'event')}</td><td>{role.role==='approver'?row.igsid??'—':maskIgsid(row.igsid)}</td><td>{displayActivityValue(row.state,'state')}</td><td>{displayActivityValue(row.error_code,'error')}</td></tr>)}</tbody></table></section>
  </main>;
}
