-- Additive on existing campaigns. Previously approved rows retain a matching revision.
create table admin_roles (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('editor','approver')),
  created_at timestamptz not null default now()
);
alter table admin_roles enable row level security;
revoke all on admin_roles from public, anon, authenticated;
grant select, insert, update, delete on admin_roles to service_role;

alter table campaigns add column revision integer not null default 1 check (revision > 0);
alter table campaigns add column approved_revision integer;
alter table campaigns add column media_caption_line text;
update campaigns set approved_revision=revision where copy_approved and links_verified;
alter table campaigns drop constraint if exists campaigns_status_check;
alter table campaigns add constraint campaigns_status_check check (status in ('draft','active','paused','archived'));

create or replace function update_campaign_copy(p_id uuid, p_patch jsonb, p_actor text)
returns setof campaigns language plpgsql security definer set search_path = public as $$
declare v_old campaigns; v_key text;
begin
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'invalid campaign patch'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key <> all(array['name','keywords','fuzzy','require_follow','delivery_style','opening_button_experiment','opening_text','opening_button_text','follow_opening_text','follow_opening_button_text','opening_button_title','follow_opening_button_title','direct_text','comparison_text','comparison_sources','delivery_text','delivery_buttons','follow_prompt_text','follow_retry_text','follow_unknown_text','follow_profile_url','comment_reply_text']) then
      raise exception 'field not editable: %', v_key;
    end if;
  end loop;
  select * into v_old from campaigns where id=p_id for update;
  if not found then raise exception 'campaign not found'; end if;
  if v_old.status not in ('draft','paused') then raise exception 'pause campaign before editing'; end if;
  return query update campaigns set
    name=coalesce(p_patch->>'name',name),
    keywords=case when p_patch ? 'keywords' then array(select jsonb_array_elements_text(p_patch->'keywords')) else keywords end,
    fuzzy=coalesce((p_patch->>'fuzzy')::boolean,fuzzy),
    require_follow=coalesce((p_patch->>'require_follow')::boolean,require_follow),
    delivery_style=coalesce(p_patch->>'delivery_style',delivery_style),
    opening_button_experiment=coalesce((p_patch->>'opening_button_experiment')::boolean,opening_button_experiment),
    opening_text=coalesce(p_patch->>'opening_text',opening_text),
    opening_button_text=coalesce(p_patch->>'opening_button_text',opening_button_text),
    follow_opening_text=coalesce(p_patch->>'follow_opening_text',follow_opening_text),
    follow_opening_button_text=coalesce(p_patch->>'follow_opening_button_text',follow_opening_button_text),
    opening_button_title=coalesce(p_patch->>'opening_button_title',opening_button_title),
    follow_opening_button_title=coalesce(p_patch->>'follow_opening_button_title',follow_opening_button_title),
    direct_text=coalesce(p_patch->>'direct_text',direct_text),
    comparison_text=coalesce(p_patch->>'comparison_text',comparison_text),
    comparison_sources=coalesce(p_patch->'comparison_sources',comparison_sources),
    delivery_text=coalesce(p_patch->>'delivery_text',delivery_text),
    delivery_buttons=coalesce(p_patch->'delivery_buttons',delivery_buttons),
    follow_prompt_text=coalesce(p_patch->>'follow_prompt_text',follow_prompt_text),
    follow_retry_text=coalesce(p_patch->>'follow_retry_text',follow_retry_text),
    follow_unknown_text=coalesce(p_patch->>'follow_unknown_text',follow_unknown_text),
    follow_profile_url=coalesce(p_patch->>'follow_profile_url',follow_profile_url),
    comment_reply_text=case when p_patch ? 'comment_reply_text' then p_patch->>'comment_reply_text' else comment_reply_text end,
    revision=revision+1, copy_approved=false, links_verified=false,
    comparison_checked_at=null, approved_revision=null, updated_at=now()
  where id=p_id returning *;
  insert into audit_log(actor,action,target,detail) values (p_actor,'campaign_edit',p_id::text,jsonb_build_object('fields',(select coalesce(jsonb_agg(changed.field_name),'[]'::jsonb) from jsonb_object_keys(p_patch) as changed(field_name) where to_jsonb(v_old)->changed.field_name is distinct from p_patch->changed.field_name)));
end; $$;
revoke all on function update_campaign_copy(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function update_campaign_copy(uuid,jsonb,text) to service_role;

create or replace function set_campaign_media(p_id uuid, p_media_id text, p_permalink text, p_caption text, p_actor text)
returns setof campaigns language plpgsql security definer set search_path = public as $$
declare v_old campaigns;
begin
  select * into v_old from campaigns where id=p_id for update;
  if not found then raise exception 'campaign not found'; end if;
  if v_old.status not in ('draft','paused') then raise exception 'pause campaign before changing post'; end if;
  if nullif(p_media_id,'') is null or p_permalink !~ '^https://(www\.)?instagram\.com/(p|reel)/[A-Za-z0-9_-]+/$' then raise exception 'invalid resolved post'; end if;
  return query update campaigns set media_id=p_media_id, media_permalink=p_permalink, media_caption_line=left(p_caption,80), revision=revision+1,
    copy_approved=false, links_verified=false, comparison_checked_at=null, approved_revision=null, updated_at=now()
    where id=p_id returning *;
  insert into audit_log(actor,action,target,detail) values (p_actor,'campaign_post',p_id::text,jsonb_build_object('fields',jsonb_build_array('media_id','media_permalink','media_caption_line')));
end; $$;
revoke all on function set_campaign_media(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function set_campaign_media(uuid,text,text,text,text) to service_role;

create or replace function set_campaign_review(p_id uuid, p_field text, p_value boolean, p_actor text, p_expected_revision integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_old campaigns; v_copy boolean; v_links boolean;
begin
  select * into v_old from campaigns where id=p_id for update;
  if not found then raise exception 'campaign not found'; end if;
  if v_old.revision is distinct from p_expected_revision then raise exception 'campaign changed since you loaded it'; end if;
  if v_old.status not in ('draft','paused') then raise exception 'campaign cannot be reviewed in this status'; end if;
  if p_field not in ('copy_approved','links_verified') then raise exception 'invalid review field'; end if;
  v_copy := case when p_field='copy_approved' then p_value else v_old.copy_approved end;
  v_links := case when p_field='links_verified' then p_value else v_old.links_verified end;
  update campaigns set copy_approved=v_copy, links_verified=v_links,
    comparison_checked_at=case when p_field='copy_approved' and p_value then now() when not v_copy then null else comparison_checked_at end,
    approved_revision=case when v_copy and v_links then revision else null end, updated_at=now() where id=p_id;
  insert into audit_log(actor,action,target,detail) values (p_actor,p_field,p_id::text,jsonb_build_object('value',p_value));
end; $$;
revoke all on function set_campaign_review(uuid,text,boolean,text,integer) from public, anon, authenticated;
grant execute on function set_campaign_review(uuid,text,boolean,text,integer) to service_role;
drop function if exists set_campaign_review(uuid,text,boolean,text);

create or replace function set_campaign_status(p_id uuid, p_status text, p_actor text, p_expected_revision integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_old campaigns;
begin
  select * into v_old from campaigns where id=p_id for update;
  if not found then raise exception 'campaign not found'; end if;
  if v_old.revision is distinct from p_expected_revision then raise exception 'campaign changed since you loaded it'; end if;
  if not ((v_old.status in ('draft','paused') and p_status='active') or
          (v_old.status='active' and p_status='paused') or
          (v_old.status in ('draft','paused') and p_status='archived')) then
    raise exception 'invalid campaign status transition';
  end if;
  if p_status='active' and (not v_old.copy_approved or not v_old.links_verified or
      v_old.approved_revision is distinct from v_old.revision or v_old.comparison_checked_at is null or v_old.media_id is null) then
    raise exception 'campaign review or media ID missing';
  end if;
  update campaigns set status=p_status, updated_at=now() where id=p_id;
  insert into audit_log(actor,action,target,detail) values (p_actor,'campaign_'||p_status,p_id::text,jsonb_build_object('from',v_old.status));
end; $$;
revoke all on function set_campaign_status(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function set_campaign_status(uuid,text,text,integer) to service_role;
drop function if exists set_campaign_status(uuid,text,text);

create or replace function delete_campaign_draft(p_id uuid, p_actor text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old campaigns;
begin
  select * into v_old from campaigns where id=p_id for update;
  if not found then raise exception 'campaign not found'; end if;
  if v_old.status <> 'draft' then raise exception 'only drafts can be deleted'; end if;
  if exists(select 1 from conversations where campaign_id=p_id) then raise exception 'campaign has conversations'; end if;
  insert into audit_log(actor,action,target,detail) values (p_actor,'campaign_delete',p_id::text,'{}'::jsonb);
  delete from campaigns where id=p_id;
end; $$;
revoke all on function delete_campaign_draft(uuid,text) from public, anon, authenticated;
grant execute on function delete_campaign_draft(uuid,text) to service_role;

create or replace function get_campaign_activity(p_id uuid)
returns table(at timestamptz, type text, label text, igsid text, state text, error_code text)
language sql security definer set search_path = public as $$
  select q.at, q.type, q.label, q.igsid, q.state, q.error_code from (
    select c.comment_at as at, 'conversation'::text as type,
      ('Comment ' || c.comment_id || '; ' || case when c.fulfilled_at is null then 'open' else 'fulfilled' end)::text as label,
      c.igsid, c.stage::text as state, null::text as error_code
    from conversations c where c.campaign_id=p_id
    union all
    select coalesce(a.sent_at,a.created_at), 'action'::text, a.kind::text, c.igsid, a.state::text, a.error_code
    from outbound_actions a join conversations c on c.id=a.conversation_id where c.campaign_id=p_id
    union all
    select l.created_at, 'audit'::text, l.action::text, coalesce(c.igsid,ca.igsid), null::text, null::text
    from audit_log l
    left join conversations c on c.campaign_id=p_id and (l.target=c.id::text or l.target=c.igsid)
    left join outbound_actions a on l.target=a.id::text
    left join conversations ca on ca.id=a.conversation_id and ca.campaign_id=p_id
    where l.target=p_id::text or c.id is not null or ca.id is not null
  ) q order by q.at desc limit 100;
$$;
revoke all on function get_campaign_activity(uuid) from public, anon, authenticated;
grant execute on function get_campaign_activity(uuid) to service_role;
