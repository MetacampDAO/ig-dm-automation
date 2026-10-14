create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- Verify both extensions and this schedule on a fresh local database with `supabase db reset`.

-- The scheduled job is named 'ig-dm-jobs'. The app finds it by the JOB_NAME environment variable (default 'ig-dm-jobs').
-- An install that already scheduled the job under another name can keep that name by setting JOB_NAME to it and not re-running this migration.
-- Run once after deployment (or use /admin Setup actions): select configure_job_runner('https://your-app.example.com', 'JOB_SECRET');
-- Only service_role may call this. pg_cron stores the command, so restrict cron.job access.
create or replace function configure_job_runner(p_app_url text, p_job_secret text)
returns void language plpgsql security definer set search_path = public as $$
declare v_url text;
begin
  if p_app_url !~ '^https://[A-Za-z0-9.-]+/?$' then raise exception 'HTTPS app origin required'; end if;
  if length(p_job_secret) < 32 then raise exception 'JOB_SECRET too short'; end if;
  v_url := rtrim(p_app_url, '/') || '/api/jobs/run';
  perform cron.unschedule('ig-dm-jobs') where exists (select 1 from cron.job where jobname='ig-dm-jobs');
  perform cron.schedule('ig-dm-jobs', '* * * * *', format(
    'select net.http_post(url := %L, headers := jsonb_build_object(''x-job-secret'', %L, ''Content-Type'', ''application/json''), body := ''{}''::jsonb);',
    v_url, p_job_secret));
end; $$;
revoke all on function configure_job_runner(text,text) from public, anon, authenticated;
grant execute on function configure_job_runner(text,text) to service_role;
