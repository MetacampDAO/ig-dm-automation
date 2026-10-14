create extension if not exists pgcrypto;

create table accounts (
  id uuid primary key default gen_random_uuid(),
  ig_user_id text not null unique,
  username text not null,
  auth_route text not null default 'instagram_login' check (auth_route = 'instagram_login'),
  access_token_enc text,
  token_obtained_at timestamptz,
  token_expires_at timestamptz,
  permissions text[] not null default '{}',
  state text not null default 'not_tested' check (state in ('not_tested','connected','reconnect_required','restricted_access')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  name text not null,
  media_id text,
  media_permalink text,
  keywords text[] not null,
  fuzzy boolean not null default false,
  require_follow boolean not null default false,
  delivery_style text not null check (delivery_style in ('direct','opening')),
  opening_button_experiment boolean not null default false,
  opening_text text not null,
  opening_button_text text not null,
  follow_opening_text text not null,
  follow_opening_button_text text not null,
  opening_button_title text not null,
  follow_opening_button_title text not null,
  direct_text text not null,
  comparison_text text not null,
  comparison_sources jsonb not null default '[]',
  comparison_checked_at timestamptz,
  delivery_text text not null,
  delivery_buttons jsonb not null,
  follow_prompt_text text not null,
  follow_retry_text text not null,
  follow_unknown_text text not null,
  follow_profile_url text not null,
  copy_approved boolean not null default false,
  links_verified boolean not null default false,
  status text not null default 'draft' check (status in ('draft','active','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not require_follow or delivery_style = 'opening')
);
create unique index campaigns_one_active_media on campaigns(account_id, media_id) where status = 'active';

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  account_ig_user_id text not null,
  field text not null,
  kind text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  process_error text,
  process_attempts integer not null default 0,
  process_lease_until timestamptz
);
create index webhook_events_unprocessed on webhook_events(received_at) where processed_at is null;

create or replace function claim_webhook_event(p_id uuid)
returns setof webhook_events language sql security definer set search_path = public as $$
  update webhook_events set process_lease_until=now()+interval '60 seconds'
  where id=p_id and processed_at is null and process_attempts<3
    and (process_lease_until is null or process_lease_until<now())
  returning *;
$$;
revoke all on function claim_webhook_event(uuid) from public, anon, authenticated;
grant execute on function claim_webhook_event(uuid) to service_role;

create or replace function finish_webhook_event(p_id uuid, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update webhook_events set
    processed_at = case when p_error is null then now() else null end,
    process_error = p_error,
    process_attempts = process_attempts + 1,
    process_lease_until = null
  where id = p_id;
$$;
revoke all on function finish_webhook_event(uuid,text) from public, anon, authenticated;
grant execute on function finish_webhook_event(uuid,text) to service_role;

create table conversations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  igsid text,
  comment_id text not null,
  comment_at timestamptz not null,
  private_reply_sent_at timestamptz,
  last_inbound_at timestamptz,
  consent_event_type text,
  stage text not null default 'opened' check (stage in ('opened','awaiting_interaction','interaction_received','follow_prompted','delivered','closed')),
  follow_state text not null default 'unknown' check (follow_state in ('unknown','true','false')),
  follow_checked_at timestamptz,
  fulfilled_at timestamptz,
  paused boolean not null default false,
  needs_human boolean not null default false,
  opted_out boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, comment_id)
);
create unique index conversations_campaign_igsid on conversations(campaign_id, igsid) where igsid is not null;

create table outbound_actions (
  id uuid primary key default gen_random_uuid(),
  action_key text not null unique,
  conversation_id uuid not null references conversations(id),
  kind text not null,
  request jsonb not null,
  state text not null default 'queued' check (state in ('queued','sending','sent','failed','uncertain','skipped')),
  provider_message_id text,
  error_code text,
  attempts integer not null default 0,
  due_at timestamptz not null default now(),
  lease_until timestamptz,
  owner text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbound_actions_due on outbound_actions(due_at) where state in ('queued','sending');

create table follow_rechecks (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references conversations(id),
  due_at timestamptz not null,
  claimed_at timestamptz
);

create table unmatched_inbound (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references webhook_events(id),
  account_ig_user_id text not null,
  igsid text not null,
  received_at timestamptz not null default now()
);

create table account_opt_outs (
  account_id uuid not null references accounts(id),
  igsid_hash text not null,
  created_at timestamptz not null default now(),
  primary key(account_id, igsid_hash)
);

create table settings (
  id boolean primary key default true check (id),
  sends_enabled boolean not null default true,
  retention_days integer not null default 90 check (retention_days between 1 and 3650)
);
insert into settings(id) values (true);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table raw_webhook_debug (
  id uuid primary key default gen_random_uuid(),
  envelope jsonb not null,
  received_at timestamptz not null default now()
);

create or replace function set_campaign_review(p_id uuid, p_field text, p_value boolean, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from campaigns where id=p_id for update;
  if not found then raise exception 'campaign not found'; end if;
  if v_status='active' and not p_value then raise exception 'pause campaign before removing approval'; end if;
  if p_field = 'copy_approved' then
    update campaigns set copy_approved=p_value, comparison_checked_at=case when p_value then now() else null end, updated_at=now() where id=p_id;
  elsif p_field = 'links_verified' then
    update campaigns set links_verified=p_value, updated_at=now() where id=p_id;
  else raise exception 'invalid review field'; end if;
  insert into audit_log(actor,action,target,detail) values (p_actor,p_field,p_id::text,jsonb_build_object('value',p_value));
end; $$;
revoke all on function set_campaign_review(uuid,text,boolean,text) from public, anon, authenticated;
grant execute on function set_campaign_review(uuid,text,boolean,text) to service_role;

create or replace function set_campaign_status(p_id uuid, p_status text, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare v_campaign campaigns;
begin
  if p_status not in ('active','paused') then raise exception 'invalid campaign status'; end if;
  select * into v_campaign from campaigns where id=p_id for update;
  if not found then raise exception 'campaign not found'; end if;
  if p_status='active' and (not v_campaign.copy_approved or not v_campaign.links_verified or v_campaign.comparison_checked_at is null or v_campaign.media_id is null) then
    raise exception 'campaign review or media ID missing';
  end if;
  update campaigns set status=p_status, updated_at=now() where id=p_id;
  insert into audit_log(actor,action,target,detail) values (p_actor,'campaign_'||p_status,p_id::text,'{}'::jsonb);
end; $$;
revoke all on function set_campaign_status(uuid,text,text) from public, anon, authenticated;
grant execute on function set_campaign_status(uuid,text,text) to service_role;

create or replace function claim_outbound(p_id uuid, p_owner text)
returns setof outbound_actions language sql security definer set search_path = public as $$
  update outbound_actions
  set state='sending', lease_until=now()+interval '60 seconds', owner=p_owner, attempts=attempts+1
  where id=p_id and due_at<=now()
    and (state='queued' or (state='sending' and lease_until<now()))
  returning *;
$$;
revoke all on function claim_outbound(uuid,text) from public, anon, authenticated;
grant execute on function claim_outbound(uuid,text) to service_role;

create or replace function advance_conversation(p_id uuid, p_stage text, p_patch jsonb default '{}')
returns setof conversations language plpgsql security definer set search_path = public as $$
declare v_old conversations; v_rank_old int; v_rank_new int;
begin
  select * into v_old from conversations where id=p_id for update;
  if not found then return; end if;
  v_rank_old := array_position(array['opened','awaiting_interaction','interaction_received','follow_prompted','delivered','closed'], v_old.stage);
  v_rank_new := array_position(array['opened','awaiting_interaction','interaction_received','follow_prompted','delivered','closed'], p_stage);
  if v_rank_new is null or v_rank_new < v_rank_old then raise exception 'invalid stage transition'; end if;
  return query update conversations set stage=p_stage,
    igsid=coalesce(p_patch->>'igsid',igsid),
    last_inbound_at=coalesce((p_patch->>'last_inbound_at')::timestamptz,last_inbound_at),
    consent_event_type=coalesce(p_patch->>'consent_event_type',consent_event_type),
    private_reply_sent_at=coalesce((p_patch->>'private_reply_sent_at')::timestamptz,private_reply_sent_at),
    follow_state=coalesce(p_patch->>'follow_state',follow_state),
    follow_checked_at=coalesce((p_patch->>'follow_checked_at')::timestamptz,follow_checked_at),
    fulfilled_at=coalesce((p_patch->>'fulfilled_at')::timestamptz,fulfilled_at),
    paused=coalesce((p_patch->>'paused')::boolean,paused),
    needs_human=coalesce((p_patch->>'needs_human')::boolean,needs_human),
    opted_out=coalesce((p_patch->>'opted_out')::boolean,opted_out),
    updated_at=now() where id=p_id returning *;
end; $$;
revoke all on function advance_conversation(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function advance_conversation(uuid,text,jsonb) to service_role;

create or replace function delete_igsid(p_account_ig_user_id text, p_igsid text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from follow_rechecks where conversation_id in
    (select c.id from conversations c join campaigns cp on cp.id=c.campaign_id join accounts a on a.id=cp.account_id where a.ig_user_id=p_account_ig_user_id and (c.igsid=p_igsid or c.comment_id in (select payload->>'id' from webhook_events where account_ig_user_id=p_account_ig_user_id and payload #>> '{from,id}'=p_igsid)));
  delete from outbound_actions where conversation_id in
    (select c.id from conversations c join campaigns cp on cp.id=c.campaign_id join accounts a on a.id=cp.account_id where a.ig_user_id=p_account_ig_user_id and (c.igsid=p_igsid or c.comment_id in (select payload->>'id' from webhook_events where account_ig_user_id=p_account_ig_user_id and payload #>> '{from,id}'=p_igsid)));
  delete from conversations where id in
    (select c.id from conversations c join campaigns cp on cp.id=c.campaign_id join accounts a on a.id=cp.account_id where a.ig_user_id=p_account_ig_user_id and (c.igsid=p_igsid or c.comment_id in (select payload->>'id' from webhook_events where account_ig_user_id=p_account_ig_user_id and payload #>> '{from,id}'=p_igsid)));
  delete from unmatched_inbound where account_ig_user_id=p_account_ig_user_id and igsid=p_igsid;
  -- Keep only the one-way STOP suppression digest; no raw IGSID is present in that table.
  delete from webhook_events where account_ig_user_id=p_account_ig_user_id and
    (payload #>> '{sender,id}' = p_igsid or payload #>> '{recipient,id}' = p_igsid or payload #>> '{from,id}' = p_igsid);
  delete from audit_log where target=p_igsid or detail->>'from_comment'=p_igsid or detail->>'from_reply'=p_igsid;
  delete from raw_webhook_debug;
end; $$;
revoke all on function delete_igsid(text,text) from public, anon, authenticated;
grant execute on function delete_igsid(text,text) to service_role;

alter table accounts enable row level security;
alter table campaigns enable row level security;
alter table webhook_events enable row level security;
alter table conversations enable row level security;
alter table outbound_actions enable row level security;
alter table follow_rechecks enable row level security;
alter table unmatched_inbound enable row level security;
alter table account_opt_outs enable row level security;
alter table settings enable row level security;
alter table audit_log enable row level security;
alter table raw_webhook_debug enable row level security;
-- No anon/authenticated policies: all app data is denied by default. Server paths use service_role.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
-- The intended RPCs above remain executable by service_role through their explicit grants.
