# Security

## What is protected

- **Webhook authenticity:** every `POST /api/webhooks/instagram` body is verified against the `X-Hub-Signature-256` HMAC (SHA-256, your Meta app secret) over the raw bytes before anything is stored. Bad signatures get HTTP 401 and write nothing. The raw body is read with a 1 MB cap.
- **Job runner:** `POST /api/jobs/run` requires the `x-job-secret` header and compares it to `JOB_SECRET` in constant time.
- **Rate limiting:** `/admin/login`, `POST /api/webhooks/instagram` and `POST /api/jobs/run` each keep a per-source-address, per-route counter in a fixed one-minute window, enforced in the database (migration `0006`) so concurrent requests cannot both pass. Defaults: login 10, webhook 600, job 12 requests per address per minute (`RATE_LIMITS` in `src/lib/rate-limit.ts`). Over the limit, the webhook and job routes return HTTP 429 with `retry-after: 60` before reading the body or comparing any secret, and login is refused before any password check. Login signals this by throwing a server-action error ("Too many attempts", or "Sign-in is temporarily unavailable" when the counter is down); production Next.js redacts that message to its generic error page, so a blocked user sees a generic error, not the text. If the counter is unreachable, login is denied (fail closed) and the webhook and job routes proceed (fail open, because the signature and secret still gate them). The source address is the first `x-forwarded-for` value, which your host must overwrite with the real client address (Vercel does; proxies that append to the header do not, and then a client can rotate the value to evade the limit). `GET /api/health` reports `rate_limit_blocked_last_hour`. This limits abuse from a single address; it is not DDoS protection, and an attacker with many addresses is not stopped. The job limit is checked before the secret, so anyone sharing the job caller's outbound address could use the 12 per minute and starve the scheduled call; the scheduler normally calls once a minute.
- **Admin access:** `/admin` and every server action call `requireAdmin()` (Supabase `getUser()` on the session token plus an `ADMIN_EMAILS` allow-list), then check the role (`editor` or `approver`) on the server. Hiding a button is never the only control.
- **Database:** Row Level Security is enabled on every app table with no anon or authenticated policies (deny by default). The service-role key is used only in server code. Security-definer functions are revoked from `public`, `anon` and `authenticated` and granted to `service_role` only.
- **Token at rest:** the Instagram access token is encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` before it is stored, and is never returned to the browser or written to logs or audit rows.
- **Opt-out hashing:** `STOP` stores a keyed HMAC digest of the account and sender ID (`OPTOUT_HASH_KEY`), not the raw ID. Deleting a person removes raw identifiers and interaction data and keeps only that one-way digest so they are never messaged again.
- **Input handling:** webhook payloads and admin forms are narrowed with zod; copy URLs must be HTTPS; database calls are parameterised; there are no uploads or raw-HTML rendering.
- **HTTP headers:** HSTS, frame denial, MIME-sniff prevention, referrer and permissions policies, and a CSP are set in `next.config.ts`.

## Known gaps

- **Rate limiting is per source address only.** Many addresses, or a host that does not set a trustworthy `x-forwarded-for`, defeat it, and one shared address (an office or VPN) shares one count. Use your host's firewall or rate-limit features for volumetric traffic. Requests blocked by the limiter still cost one database call each.
- **Supabase Auth's own sign-in limit can still lock admins out.** `signInWithPassword` runs server-side, so Supabase Auth sees your host's egress IP, not the attacker's. Supabase limits password sign-in per IP (documented at roughly 30 per minute sustained), and the in-app limit is 10 per address per minute, so a handful of attacker addresses can exhaust the bucket real admins share and lock them out for a few minutes. Supabase offers an optional IP Address Forwarding setting that passes the real client address to Auth; it needs a secret key on the login client and changes the auth path, so it is a decision for the operator and is not enabled here.
- **CSP allows inline scripts** (`script-src 'unsafe-inline'`) for Next.js bootstrap. A nonce-based policy would be tighter.
- **`JOB_SECRET` is stored in plaintext** inside the `pg_cron` command in `cron.job`, because the database calls the job route itself. Restrict access to `cron.job` and rotate the secret (then re-run **Schedule job runner**) if it may have leaked.
- Some Meta behaviours are not verified live; see [docs/UNVERIFIED.md](docs/UNVERIFIED.md).

## Operating it safely

Disable public Supabase signups. Keep `META_TOKEN_INPUT` set only during account connection. Keep `DEBUG_RAW_EVENTS=0` except for short, restricted debugging. Never commit env files or paste tokens into chats or issues.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue for a security problem. Include the affected version or commit, reproduction steps and the impact.
