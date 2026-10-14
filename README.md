# ig-dm-automation

Comment-to-DM automation for one Instagram professional account. When someone comments a trigger word on a post you chose, the app sends them a private DM, and (optionally after they tap a button or reply `SEND`, and optionally after confirming they follow you) delivers your links, then optionally posts a short public reply under their comment. Campaigns, messages, approvals and activity are managed in an `/admin` editor. It is a Next.js 15 app on Vercel, with Supabase (Postgres, Auth, and `pg_cron` + `pg_net` as the one-minute job runner) and the Meta Instagram API with **Instagram Login** (`graph.instagram.com`), run under Standard Access on your own account.

## Limits

Read these before you spend an hour on setup.

- **One Instagram account per deployment.**
- The Meta app must be switched to **Live** before anyone who is not an app tester can trigger it. Live mode needs a privacy policy URL and a data-deletion page that you host.
- Private replies are **text** (a button template is tried and falls back to text if Instagram refuses it), one per comment, within 7 days.
- Follow-up messages are only allowed within **24 hours** of the person's reply or tap.
- Meta rate limits apply (for private replies, hundreds per hour per account); the app retries and records failures but does not raise Meta's limits.
- Runs within the Supabase free tier and Vercel Hobby limits. Vercel Hobby is for non-commercial use, so a business account needs Vercel Pro.
- Some Meta behaviours depend on your app's access level and are listed in [docs/UNVERIFIED.md](docs/UNVERIFIED.md).

## How the flow works

1. A person comments a keyword on a post that has an active campaign; the app sends one private reply to that comment.
2. Depending on the campaign, that DM is a complete message, a button, or a request to reply `SEND`; the tap or reply opens the 24-hour window.
3. Optionally the app checks that the person follows you, then sends the links message and, if set, a public reply under the comment. `STOP` opts out; `HELP` pauses and flags a human.
4. Every campaign needs a human approver to tick two review boxes before it can go live, and only one campaign can be active per post.

The full walkthrough is in [docs/HOW-TO.md](docs/HOW-TO.md#1-what-it-does-in-one-flow).

## Prerequisites

- An Instagram **professional** (Business or Creator) account.
- A [Meta developer](https://developers.facebook.com/) account and app.
- A public **privacy policy URL** and a **data-deletion instructions page**. You host these; the repo ships neither. Meta will not let an app go Live (step 4) without them, and an app that is not Live only reacts to comments from people with an app role.
- A [Supabase](https://supabase.com/) project.
- A [Vercel](https://vercel.com/) account.
- Node.js 20 or newer for local work.

## Setup

Follow the steps in order. Meta dashboard detail, app roles and SQL fallbacks are in [docs/META-SETUP.md](docs/META-SETUP.md).

1. **Clone and install.**
   ```bash
   git clone <your fork>
   cd ig-dm-automation
   npm install
   cp .env.example .env.local
   ```
2. **Generate the random values** with the commands in the environment table below (`WEBHOOK_VERIFY_TOKEN`, `TOKEN_ENCRYPTION_KEY`, `OPTOUT_HASH_KEY`, `JOB_SECRET`) and keep them for step 5. Fill them into `.env.local` before running `npm run dev`; the placeholders in `.env.example` fail validation.
3. **Create the Supabase project.** In the SQL editor run, in order: `supabase/migrations/0001_init.sql`, `0002_jobs_cron.sql`, `0003_job_readback.sql`, `0004_comment_reply.sql`, `0005_campaign_editor.sql`, `0006_rate_limits.sql`. Enable `pg_cron` and `pg_net` in the Extensions dashboard if `0002` asks. In Auth settings, **disable public signups**, then create an admin user (email and password) in the dashboard. Copy the project URL, the anon / publishable key and the service_role / secret key.
4. **Create the Meta app.** Follow [docs/META-SETUP.md](docs/META-SETUP.md) section 1 (steps 1 to 5 and 8 now, step 6 after deploying): add the Instagram product with **API setup with Instagram login**, request the three permissions, add testers, generate a long-lived token, and enter your privacy policy URL and data-deletion page. Note the **Instagram app secret** (see `META_APP_SECRET` below). Also open the Instagram app on the connected account and turn on **Allow access to messages** (Settings > Messages and story replies > Connected tools), or no DMs will be delivered. Switch the app to **Live** before step 9.
5. **Set the environment variables** in Vercel (production, and `.env.local` for local work), using the table below. Set `META_MOCK=0` in Vercel; keep `META_MOCK=1` in `.env.local` for local work. For setup, also add `META_TOKEN_INPUT` (your long-lived Instagram token, marked **Sensitive**) and, if you know the real lifetime, `META_TOKEN_EXPIRES_IN` (seconds, default `5184000`).
6. **Deploy** to Vercel (import the repo, or `vercel deploy`). `APP_URL` must be the final HTTPS origin; redeploy if you change it.
7. **Run the Setup actions.** Sign in at `/admin`, then in the **Setup** section click, in order: **Connect account**, **Seed draft campaign** (an unapproved example), **Subscribe webhooks**, **Schedule job runner**. Then delete `META_TOKEN_INPUT` (and `META_TOKEN_EXPIRES_IN`) from Vercel.
8. **Point Meta at the webhook.** In the app dashboard's Instagram webhooks setup, set the callback URL to `https://<your-app-origin>/api/webhooks/instagram` and the verify token to your `WEBHOOK_VERIFY_TOKEN`, and subscribe to `comments`, `messages`, `messaging_postbacks`. Then check `GET /api/health`: database true, account `connected`, `jobs_scheduled` true. Optional until you add a second admin: grant an approver role (SQL in [docs/META-SETUP.md](docs/META-SETUP.md#2-roles)); with no roles set, every allow-listed admin is an approver.
9. **Create your first campaign** with a test keyword on a test post. Read [docs/HOW-TO.md](docs/HOW-TO.md), tap every link on a phone, tick both review boxes, activate, and comment the keyword from an ordinary account.

### Environment variables

Required:

| Variable | What to put |
|---|---|
| `META_APP_ID` | The Instagram app ID shown on the same **API setup with Instagram login** page as the secret |
| `META_APP_SECRET` | The **Instagram app secret**, shown on the Meta App Dashboard under the **Instagram** product > **API setup with Instagram login** page. It is not the App secret under Settings > Basic. This one value is used for both the webhook signature check and the token exchange |
| `WEBHOOK_VERIFY_TOKEN` | Any random string: `openssl rand -hex 16`. Reused in the Meta webhook form |
| `SUPABASE_URL` | Supabase project settings > API |
| `SUPABASE_ANON_KEY` | The anon / publishable key, same page |
| `SUPABASE_SERVICE_ROLE_KEY` | The service_role / secret key, same page. Server only; never prefix with `NEXT_PUBLIC_` |
| `ADMIN_EMAILS` | Comma-separated emails allowed into `/admin`; each must also exist in Supabase Auth |
| `META_MOCK` | `0` for a real account, `1` for local fixtures |
| `TOKEN_ENCRYPTION_KEY` | Base64 of 32 random bytes: `openssl rand -base64 32`. Keep it across deploys |
| `OPTOUT_HASH_KEY` | A second, different `openssl rand -base64 32`. Keep it across deploys |
| `JOB_SECRET` | At least 32 characters: `openssl rand -hex 24`. Authenticates the job runner |
| `APP_URL` | HTTPS origin of your deployment, no path or port |
| `IG_USERNAME` | Your Instagram username, no `@`. Every route needs it |

Optional:

| Variable | What to put |
|---|---|
| `META_API_VERSION` | Default `v25.0` |
| `BRAND_NAME` | Title shown in the app. Default `IG DM Automation` |
| `REQUIRED_DISCLOSURE_URL`, `REQUIRED_DISCLOSURE_TEXT` | Set both or neither. If set, any message or button linking to that URL must contain that text. In Vercel, enter the text without surrounding quotes |
| `CAMPAIGN_MEDIA_ID`, `CAMPAIGN_MEDIA_PERMALINK` | Post to attach to the seeded draft; otherwise both stay empty |
| `DEBUG_RAW_EVENTS` | Default `0`. `1` temporarily stores complete webhook envelopes; use it only with a retention plan |

### Troubleshooting

- **Every webhook returns 401** (no visible error in the app): `META_APP_SECRET` is the wrong secret. Use the Instagram app secret from the Instagram > API setup with Instagram login page, not the one under Settings > Basic.
- **"Schedule job runner" or health reports no job:** apply all six migrations and enable `pg_cron` and `pg_net`.

## Local development

```bash
npm test            # vitest, in-memory repository, META_MOCK=1, no network
npm run typecheck
npm run build
npm run dev         # fill in the generated values from step 2 first
```

Keep `META_MOCK=1` locally; no call goes to Meta. Never commit an env file.

## Security

HMAC-verified webhooks, a constant-time job secret, an admin allow-list with roles, deny-by-default Row Level Security, encrypted token storage and hashed opt-outs. Public routes (login, webhook, job runner) are rate limited per source address in the database (migration `0006`, defaults in `src/lib/rate-limit.ts`); this is abuse control, not DDoS protection. Details and known gaps are in [SECURITY.md](SECURITY.md). Report vulnerabilities through GitHub private vulnerability reporting. See also [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/META-API-NOTES.md](docs/META-API-NOTES.md).

## Attribution and license

Built and run in production by Metacamp.

Released under the [MIT License](LICENSE).
