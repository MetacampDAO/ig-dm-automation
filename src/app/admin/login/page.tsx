import { env } from '@/lib/env';
import { login } from '../actions';

export const dynamic = 'force-dynamic';
export default function LoginPage() {
  return <main><h1>{env().BRAND_NAME} admin</h1><form action={login}><label>Email <input name="email" type="email" required /></label><label>Password <input name="password" type="password" required /></label><button type="submit">Sign in</button></form></main>;
}
