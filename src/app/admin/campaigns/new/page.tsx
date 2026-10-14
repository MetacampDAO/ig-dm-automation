import Link from 'next/link';
import { forbidden, redirect } from 'next/navigation';
import { AdminAuthError, requireAdmin, requireRole } from '@/lib/admin';
import { SupabaseRepository } from '@/lib/supabase-repository';
import { NewCampaignForm } from './new-campaign-form';

export const dynamic='force-dynamic';
export default async function NewCampaignPage() {
  let admin; try { admin=await requireAdmin(); } catch(error) { if(error instanceof AdminAuthError){if(error.status===401)redirect('/admin/login');forbidden();} throw error; }
  const repo=new SupabaseRepository(); const role=await requireRole('editor',admin,repo); const accounts=await repo.adminAccounts();
  return <main><header><h1>New campaign</h1><Link href="/admin">Back to campaigns</Link></header>{accounts.length===1?<><p>Account: @{accounts[0].username} · role: {role.role}</p><NewCampaignForm accountId={accounts[0].id}/></>:<section><p>Exactly one connected account is required to create a campaign. Found {accounts.length}.</p></section>}</main>;
}
