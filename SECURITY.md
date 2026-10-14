# Security

## What is protected

- **Webhook authenticity:** every `POST /api/webhooks/instagram` body is verified against the `X-Hub-Signature-256` HMAC (SHA-256, your Meta app secret) over the raw bytes before anything is stored. Bad signatures get HTTP 401 and write nothing. The raw body is read with a 1 MB cap.
- **Job runner:** `POST /api/jobs/run` requires the `x-job-secret` header and compares it to `JOB_SECRET` in constant time.
- **Admin access:** `/admin` and every server action call `requireAdmin()` (Supabase `getUser()` on the session token plus an `ADMIN_EMAILS` allow-list), then check the role (`editor` or `approver`) on the server. Hiding a button is never the only control.
- **Database:** Row Level Security is enabled on every app table with no anon or authenticated policies (deny by default). The service-role key is used only in server code. Security-definer functions are revoked from `public`, `anon` and `authenticated` and granted to `service_role` only.
- **Token at rest:** the Instagram access token is encrypted with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` before it is stored, and is never returned to the browser or written to logs or audit rows.
- **Opt-out hashing:** `STOP` stores a keyed HMAC digest of the account and sender ID (`OPTOUT_HASH_KEY`), not the raw ID. Deleting a person removes raw identifiers and interaction data and keeps only that one-way digest so they are never messaged again.
- **Input handling:** webhook payloads and admin forms are narrowed with zod; copy URLs must be HTTPS; database calls are parameterised; there are no uploads or raw-HTML rendering.
- **HTTP headers:** HSTS, frame denial, MIME-sniff prevention, referrer and permissions policies, and a CSP are set in `next.config.ts`.

## Known gaps

- **No edge rate limiting** on `/admin/login`, the webhook route or the job route. Login does not get Supabase Auth's per-IP limits in practice: `signInWithPassword` runs server-side, so Supabase sees your host's egress IPs, not the attacker's. Nothing limits a single attacker, and a flood of attempts can trip the shared limit and lock real admins out. A flood of invalid webhook requests could consume serverless execution time even though each is rejected at the signature check. An in-app limiter is planned; until then, consider your host's firewall or rate-limit features.
- **CSP allows inline scripts** (`script-src 'unsafe-inline'`) for Next.js bootstrap. A nonce-based policy would be tighter.
- **`JOB_SECRET` is stored in plaintext** inside the `pg_cron` command in `cron.job`, because the database calls the job route itself. Restrict access to `cron.job` and rotate the secret (then re-run **Schedule job runner**) if it may have leaked.
- Some Meta behaviours are not verified live; see [docs/UNVERIFIED.md](docs/UNVERIFIED.md).

## Operating it safely

Disable public Supabase signups. Keep `META_TOKEN_INPUT` set only during account connection. Keep `DEBUG_RAW_EVENTS=0` except for short, restricted debugging. Never commit env files or paste tokens into chats or issues.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue for a security problem. Include the affected version or commit, reproduction steps and the impact.
