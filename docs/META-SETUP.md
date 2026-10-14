# Meta dashboard detail, roles and SQL fallbacks

This project uses **Instagram API with Instagram Login** on `graph.instagram.com`. It does not use a Facebook Page token. The [README](../README.md) is the one ordered setup sequence and holds the only environment table; this page is the detail for the Meta dashboard, app roles and the SQL fallbacks. Dashboard labels change, so treat the wording below as a guide and check [META-API-NOTES.md](META-API-NOTES.md) for the underlying endpoints.

Apply **all five migrations** before you deploy. The admin pages read revision, role and post-caption columns and call RPCs that only exist after `0005`.

## 1. Meta App Dashboard

1. Confirm your Instagram account is a **professional** (Business or Creator) account. Check which tools already respond to comments on it (Business Suite automations, other auto-responders) and disable any that overlap with the post you will use.
2. In [Meta for Developers](https://developers.facebook.com/apps/), create an app (or pick one you own). Add the **Instagram** product and choose **API setup with Instagram login**. Use this route throughout.
3. **Find the right app secret.** On the same **API setup with Instagram login** page, under the Instagram app ID and secret, copy the **Instagram app secret**. That value is `META_APP_SECRET`. It is not the App secret under **Settings > Basic**. The app uses this one value twice: to verify the `X-Hub-Signature-256` signature on every webhook and as the `client_secret` when it exchanges the token. Put the app ID and this secret in your Vercel environment variables, never in a repo.
4. In Instagram API setup, connect your Instagram account under the account and permissions setup. Request these permissions:
   - `instagram_business_basic`
   - `instagram_business_manage_comments`
   - `instagram_business_manage_messages`

   Do not request content publishing; this tool does not use it. Add yourself and any testers in **App roles** and have them accept their invitations.
5. In the Instagram API setup token section, use **Generate token** for the connected account. The dashboard-generated token is long-lived (about 60 days). Put it in `META_TOKEN_INPUT` as a **Sensitive** Vercel environment variable, and set `META_TOKEN_EXPIRES_IN` (seconds) if you know the real lifetime; the app defaults to 5,184,000. Do not paste the token into a chat, screenshot, document or shell history. The app never returns or logs it. Delete `META_TOKEN_INPUT` from Vercel after **Connect account** succeeds.
6. After you have deployed and run the Setup actions (README steps 6 and 7), open the App Dashboard **Webhooks** setup for Instagram. Set **Callback URL** to `https://<your-app-origin>/api/webhooks/instagram` and **Verify token** to the exact `WEBHOOK_VERIFY_TOKEN` value. Subscribe the app-level fields `comments`, `messages`, `messaging_postbacks`, and verify the GET handshake in the dashboard. Add `message_echoes` only if you want to test it; the parser ignores echoes. The account-level subscription from the **Subscribe webhooks** Setup action is also required.
7. Confirm the Instagram account allows connected tools to access messages (Instagram settings, "Allow access to messages"). Use one app-role account and one ordinary non-tester account to prove comment, private reply, inbound SEND, postback, follow check and delivery.
8. **Switch the app to Live mode before testing with anyone who is not an app tester.** In Development mode Meta only delivers comment webhooks from people with an app role. Meta requires a working **privacy policy URL** and a **data-deletion instructions page** (both hosted by you) in the app settings before it allows Live, because the app processes messages from people who never agreed to anything on Meta's side. Under Standard Access, an account you own can usually be automated for its own audience once the app is Live; if ordinary commenters still do not trigger webhooks, request Advanced Access for the permissions above. Meta may ask for Business Verification, a reviewer account and a screencast for Advanced Access. Do not assume approval or timing.

Record any mismatch between dashboard wording and the steps above in [UNVERIFIED.md](UNVERIFIED.md) before activating a campaign.

**Troubleshooting:** if every webhook returns 401 with no visible error, `META_APP_SECRET` is the wrong secret. Use the Instagram app secret from step 3.

## 2. Roles

Roles live in `admin_roles`. Use the lowercase email that exists both in Supabase Auth and `ADMIN_EMAILS`; the address below is a placeholder. Run the SQL in a privileged Supabase session. This is optional until you add a second admin: while `admin_roles` is empty, every allow-listed admin is an approver.

```sql
insert into admin_roles(email, role) values ('you@example.com', 'approver')
on conflict (email) do update set role = excluded.role;

select email, role, created_at from admin_roles order by email;
```

While `admin_roles` has no rows, every allow-listed admin is an approver and `/admin` shows a bootstrap warning. Once any row exists, an allow-listed email without a row is an editor. To go back to bootstrap mode, delete all rows (`delete from admin_roles;`); this only changes role mapping and loses no campaigns. Remove access at `ADMIN_EMAILS` or Supabase Auth if the broader bootstrap access is not acceptable.

## 3. Optional public comment reply

The public reply under the commenter's comment is off by default. Set it per campaign in the editor (see HOW-TO). A privileged operator can also set or clear it in SQL:

```sql
update campaigns set comment_reply_text = 'Sent you a DM. Check your inbox or message requests.'
where name = '<campaign name>' and account_id = '<account UUID>';

update campaigns set comment_reply_text = null
where name = '<campaign name>' and account_id = '<account UUID>';
```

Saving in the editor resets approvals, so a SQL change should be followed by a fresh review.

## 4. Fallback: set the post by SQL

Use this **only on a draft or paused campaign**, and only if live media listing fails and you have verified the post ID and permalink yourself. It mirrors the editor's revision reset, so review must be repeated.

```sql
begin;
update campaigns set media_id='<verified Meta media ID>',
  media_permalink='https://www.instagram.com/p/SHORTCODE/',
  media_caption_line=null, revision=revision+1,
  copy_approved=false, links_verified=false,
  comparison_checked_at=null, approved_revision=null, updated_at=now()
where id='<campaign UUID>'::uuid and status in ('draft','paused')
returning id, status, media_id, media_permalink, revision, approved_revision;
-- Expect exactly one row before committing.
insert into audit_log(actor, action, target, detail)
values ('sql-fallback', 'campaign_post', '<campaign UUID>',
  '{"fields":["media_id","media_permalink","media_caption_line"]}'::jsonb);
commit;
```

## 5. Job runner name (existing installs only)

The **Schedule job runner** Setup action installs a one-minute `pg_cron` job named `ig-dm-jobs` that POSTs to `/api/jobs/run` with `x-job-secret`; repeat it after changing `APP_URL` or `JOB_SECRET`. The cron command stores that secret in the database (in `cron.job`, in plaintext), so keep access to `cron.job` restricted.

`JOB_NAME` is for **existing installs whose job already has another name only**. Leave it unset on a fresh install: the SQL functions in migrations `0002` and `0003` hardcode `ig-dm-jobs`, so a different `JOB_NAME` makes "Schedule job runner" fail its readback and health report `jobs_scheduled: false`. An existing install can set `JOB_NAME` to its old job name, or re-run **Schedule job runner** after applying the updated `0002` to re-register as `ig-dm-jobs`.

## 6. Health check

`GET /api/health` returns database, account and job-runner status and nothing secret. It is safe for an external uptime ping.
