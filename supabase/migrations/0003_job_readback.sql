-- The job name here must match the JOB_NAME environment variable (default 'ig-dm-jobs').
-- An existing install may keep its old job name by setting JOB_NAME to it and editing the name in this function.
-- Keep the draft seed idempotent even when two setup requests arrive together.
create unique index if not exists campaigns_account_name_unique on campaigns(account_id, name);

create or replace function get_job_runner_status()
returns table(jobname text, schedule text, active boolean)
language sql security definer set search_path = public as $$
  select j.jobname::text, j.schedule::text, j.active
  from cron.job as j
  where j.jobname = 'ig-dm-jobs';
$$;
revoke all on function get_job_runner_status() from public, anon, authenticated;
grant execute on function get_job_runner_status() to service_role;
