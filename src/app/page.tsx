import Link from 'next/link';
import { env } from '@/lib/env';
export const dynamic = 'force-dynamic';
export default function Home() { return <main><h1>{env().BRAND_NAME}</h1><p>Operator access is at <Link href="/admin">/admin</Link>.</p></main>; }
