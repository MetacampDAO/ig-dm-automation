import { createClient } from '@supabase/supabase-js';
import { env } from './env';

export function serviceDb() {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
export function anonDb() {
  const e = env();
  return createClient(e.SUPABASE_URL, e.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}
