'use server';

import { cookies } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { z } from 'zod';
import { anonDb } from '@/lib/supabase';
import { AdminAuthError, authorizeAdmin, requireAdmin, requireRole } from '@/lib/admin';
import { SupabaseRepository } from '@/lib/supabase-repository';
import { DatabaseError } from '@/lib/database-error';
import { env } from '@/lib/env';
import { validateCampaignCopy } from '@/lib/copy';

export async function login(form: FormData): Promise<void> {
  const credentials=z.object({email:z.email(),password:z.string().min(1)}).parse({email:form.get('email'),password:form.get('password')});
  const {data,error}=await anonDb().auth.signInWithPassword(credentials);
  if(error||!data.session) throw new Error('Invalid login');
  try { authorizeAdmin(data.user?.email,env().ADMIN_EMAILS); } catch { throw new Error('Invalid login'); }
  (await cookies()).set('admin_access',data.session.access_token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:data.session.expires_in});
  redirect('/admin');
}
export async function logout(): Promise<void> {
  try { await requireAdmin(); } catch(error) { if(error instanceof AdminAuthError&&error.status===403) forbidden(); }
  (await cookies()).delete('admin_access'); redirect('/admin/login');
}
async function approver() { try { const admin=await requireAdmin(); await requireRole('approver',admin); return admin.email; } catch(error) { if(error instanceof AdminAuthError&&error.status===403) forbidden(); throw error; } }
export async function setCampaignReview(form: FormData): Promise<void> {
  const email=await approver(); const id=z.uuid().parse(form.get('id')); const field=z.enum(['copy_approved','links_verified']).parse(form.get('field')); const value=z.enum(['true','false']).parse(form.get('value'))==='true'; const revision=z.coerce.number().int().positive().parse(form.get('revision'));
  const repo=new SupabaseRepository();
  if(value) { const campaign=await repo.getCampaign(id); if(!campaign) throw new Error('campaign not found'); if(campaign.revision!==revision) redirect(`/admin/campaigns/${id}?error=stale`); try { validateCampaignCopy(campaign); } catch { redirect(`/admin/campaigns/${id}?error=copy-invalid`); } }
  try { await repo.setCampaignReview(id,field,value,email,revision); } catch(error) { if(error instanceof DatabaseError&&error.message.includes('campaign changed since you loaded it')) redirect(`/admin/campaigns/${id}?error=stale`); throw error; } redirect(`/admin/campaigns/${id}`);
}
export async function setCampaignStatus(form: FormData): Promise<void> {
  const email=await approver(); const id=z.uuid().parse(form.get('id')); const status=z.enum(['active','paused']).parse(form.get('status')); const revision=z.coerce.number().int().positive().parse(form.get('revision')); const repo=new SupabaseRepository();
  if(status==='active') { const campaign=await repo.getCampaign(id); if(!campaign) throw new Error('campaign not found'); if(campaign.revision!==revision) redirect(`/admin/campaigns/${id}?error=stale`); try { validateCampaignCopy(campaign); } catch { redirect(`/admin/campaigns/${id}?error=copy-invalid`); } }
  try { await repo.setCampaignStatus(id,status,email,revision); } catch(error) { if(error instanceof DatabaseError&&error.code==='23505') redirect(`/admin/campaigns/${id}?error=media-conflict`); if(error instanceof DatabaseError&&error.message.includes('campaign changed since you loaded it')) redirect(`/admin/campaigns/${id}?error=stale`); if(error instanceof DatabaseError&&error.message.includes('campaign review or media ID missing')) redirect(`/admin/campaigns/${id}?error=review-required`); throw error; }
  redirect(`/admin/campaigns/${id}`);
}
