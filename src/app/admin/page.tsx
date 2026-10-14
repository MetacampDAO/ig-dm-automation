import Link from 'next/link';
import { forbidden, redirect } from 'next/navigation';
import { AdminAuthError, maskIgsid, requireAdmin, requireRole } from '@/lib/admin';
import { env } from '@/lib/env';
import { SupabaseRepository } from '@/lib/supabase-repository';
import { serviceDb } from '@/lib/supabase';
import { logout } from './actions';
import { SetupSection } from './setup-section';
import { DuplicateButton } from './campaigns/duplicate-button';
import { ConnectionPanel, RoleBanner } from './overview';
import { campaignModeLabel, displayActivityValue } from '@/lib/campaign-fields';

export const dynamic='force-dynamic';
export default async function AdminPage({searchParams}:{searchParams:Promise<{show?:string;error?:string}>}) {
  let admin; try { admin=await requireAdmin(); } catch(error) { if(error instanceof AdminAuthError){if(error.status===401)redirect('/admin/login');forbidden();} throw error; }
  const repo=new SupabaseRepository(); const role=await requireRole('editor',admin,repo); const showArchived=(await searchParams).show==='archived';
  const [accounts,campaigns,health,events,actions,handoffs]=await Promise.all([
    repo.adminAccounts(),repo.listCampaigns(showArchived),repo.connectionHealth(),
    serviceDb().from('webhook_events').select('id,field,kind,received_at,processed_at,process_error').order('received_at',{ascending:false}).limit(100),
    serviceDb().from('outbound_actions').select('id,kind,state,error_code,attempts,created_at').order('created_at',{ascending:false}).limit(100),
    serviceDb().from('conversations').select('id,igsid,stage,paused,updated_at').eq('needs_human',true).order('updated_at',{ascending:false}).limit(100),
  ]);
  for(const result of [events,actions,handoffs]) if(result.error) throw result.error;
  const mock=env().META_MOCK==='1';
  return <main><header><h1>{env().BRAND_NAME}</h1><form action={logout}><button>Sign out</button></form></header>
    <p>Signed in as {admin.email} · {role.role}</p><RoleBanner bootstrap={role.bootstrap}/>
    {(await searchParams).error&&<p role="alert">Campaign action failed: {(await searchParams).error}</p>}
    {role.role==='approver'&&<SetupSection />}
    <ConnectionPanel accounts={accounts} health={health} mock={mock}/>
    <section><h2>Accounts</h2><table><thead><tr><th>Username</th><th>IG ID</th><th>Token expiry</th><th>State</th></tr></thead><tbody>{accounts.map((a)=><tr key={a.id}><td>{a.username}</td><td>{role.role==='approver'?a.ig_user_id:maskIgsid(a.ig_user_id)}</td><td>{a.token_expires_at??'not tested'}</td><td>{a.state}</td></tr>)}</tbody></table></section>
    <section><header><h2>Campaigns</h2><div><Link href="/admin/campaigns/new">New campaign</Link> · <Link href={showArchived?'/admin':'/admin?show=archived'}>{showArchived?'Hide archived':'Show archived'}</Link></div></header><table><thead><tr><th>Name</th><th>Post</th><th>Mode</th><th>Comment reply</th><th>Status</th><th>Review</th><th>Actions</th></tr></thead><tbody>{campaigns.map((c)=><tr key={c.id}><td>{c.name}</td><td>{c.media_permalink?<a href={c.media_permalink}>{c.media_permalink}</a>:'No post'}</td><td>{campaignModeLabel(c)}; follow {c.require_follow?'on':'off'}</td><td>{c.comment_reply_text?.trim()||'off'}</td><td>{c.status}</td><td>{c.copy_approved&&c.links_verified&&c.approved_revision===c.revision?'approved':'review needed'}</td><td><Link href={`/admin/campaigns/${c.id}`}>Edit</Link> {c.status!=='archived'&&<DuplicateButton id={c.id} />}</td></tr>)}</tbody></table></section>
    <section><h2>Last 100 webhook events</h2><table><thead><tr><th>Time</th><th>Field</th><th>Kind</th><th>Processed</th><th>Error</th></tr></thead><tbody>{events.data?.map((e)=><tr key={e.id}><td>{e.received_at}</td><td>{e.field}</td><td>{e.kind}</td><td>{e.processed_at??'pending'}</td><td>{e.process_error}</td></tr>)}</tbody></table></section>
    <section><h2>Last 100 outbound actions</h2><table><thead><tr><th>Time</th><th>Kind</th><th>State</th><th>Attempts</th><th>Error</th></tr></thead><tbody>{actions.data?.map((a)=><tr key={a.id}><td>{a.created_at}</td><td>{a.kind}</td><td>{displayActivityValue(a.state,'state')}</td><td>{a.attempts}</td><td>{displayActivityValue(a.error_code,'error')}</td></tr>)}</tbody></table></section>
    <section><h2>Human handoffs</h2><table><thead><tr><th>Updated</th><th>IGSID</th><th>Stage</th><th>Paused</th></tr></thead><tbody>{handoffs.data?.map((h)=><tr key={h.id}><td>{h.updated_at}</td><td>{role.role==='approver'?h.igsid:maskIgsid(h.igsid)}</td><td>{h.stage}</td><td>{h.paused?'yes':'no'}</td></tr>)}</tbody></table></section>
  </main>;
}
