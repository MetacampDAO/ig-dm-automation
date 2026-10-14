import { z } from 'zod';

function blankToUndefined<T extends z.ZodType>(inner: T) { return z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), inner); }

const schema = z.object({
  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  META_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v25.0'),
  WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
  ADMIN_EMAILS: z.string().transform((s) => s.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)).pipe(z.array(z.email()).min(1)),
  META_MOCK: z.enum(['0', '1']),
  TOKEN_ENCRYPTION_KEY: z.string().refine((s) => { try { return Buffer.from(s, 'base64').length === 32; } catch { return false; } }, 'must be base64-encoded 32 bytes'),
  OPTOUT_HASH_KEY: z.string().refine((s) => { try { return Buffer.from(s, 'base64').length === 32; } catch { return false; } }, 'must be base64-encoded 32 bytes'),
  JOB_SECRET: z.string().min(32),
  APP_URL: z.url().refine((value) => /^https:\/\/[A-Za-z0-9.-]+\/?$/.test(value) && new URL(value).origin === value.replace(/\/$/, ''), 'must be an HTTPS origin without a path, query, fragment, or port'),
  DEBUG_RAW_EVENTS: z.enum(['0', '1']).default('0'),
  BRAND_NAME: z.string().trim().min(1).max(80).default('IG DM Automation'),
  IG_USERNAME: z.string().trim().regex(/^[A-Za-z0-9._]{1,30}$/, 'must be the Instagram username without @'),
  REQUIRED_DISCLOSURE_URL: blankToUndefined(z.url().refine((v) => v.startsWith('https://'), 'must be an HTTPS URL').optional()),
  REQUIRED_DISCLOSURE_TEXT: blankToUndefined(z.string().trim().min(1).max(500).optional()),
  JOB_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,63}$/).default('ig-dm-jobs'),
}).refine((v) => Boolean(v.REQUIRED_DISCLOSURE_URL) === Boolean(v.REQUIRED_DISCLOSURE_TEXT), { message: 'REQUIRED_DISCLOSURE_URL and REQUIRED_DISCLOSURE_TEXT must be set together or both left empty', path: ['REQUIRED_DISCLOSURE_URL'] });

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  cached = parsed.data;
  return cached;
}

export function resetEnvForTests(): void { cached = undefined; }
