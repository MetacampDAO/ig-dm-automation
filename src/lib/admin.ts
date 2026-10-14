import { cookies } from 'next/headers';
import { env } from './env';
import { anonDb } from './supabase';
import { SupabaseRepository } from './supabase-repository';
import type { AdminRole, Repository } from './repository';

export class AdminAuthError extends Error { constructor(public status: 401 | 403) { super(status === 401 ? 'Login required' : 'Forbidden'); } }
export function authorizeAdmin(email: string | undefined, allow: string[]): void {
  if (!email) throw new AdminAuthError(401);
  if (!allow.includes(email.toLowerCase())) throw new AdminAuthError(403);
}
export async function requireAdmin(): Promise<{ id: string; email: string }> {
  const token = (await cookies()).get('admin_access')?.value;
  if (!token) throw new AdminAuthError(401);
  const { data, error } = await anonDb().auth.getUser(token);
  if (error || !data.user?.email) throw new AdminAuthError(401);
  authorizeAdmin(data.user.email, env().ADMIN_EMAILS);
  return { id: data.user.id, email: data.user.email };
}
export async function requireRole(required: AdminRole, admin: { email: string }, repo: Pick<Repository,'adminRoleState'> = new SupabaseRepository()): Promise<{ role: AdminRole; bootstrap: boolean }> {
  const state=await repo.adminRoleState(admin.email.toLowerCase());
  if(required==='approver'&&state.role!=='approver') throw new AdminAuthError(403);
  return state;
}
export function maskIgsid(value: string | null): string { return value ? `••••${value.slice(-4)}` : 'unknown'; }
