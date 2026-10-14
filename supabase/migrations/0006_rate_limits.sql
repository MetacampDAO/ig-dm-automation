-- Per-source, per-route request counters in fixed windows. The app calls rate_limit_hit() before any other work on the login action, the webhook POST and the job route.
-- One insert-or-update statement per hit, so concurrent requests cannot both pass the limit. Old windows are deleted by the job runner (purge).
create table if not exists rate_limits (
  key text not null,
  route text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  blocked integer not null default 0,
  primary key (key, route, window_start)
);
alter table rate_limits enable row level security;
revoke all on table rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table rate_limits to service_role;

create or replace function rate_limit_hit(p_key text, p_route text, p_limit integer, p_window_seconds integer)
returns table(allowed boolean, count integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_window timestamptz; v_count integer;
begin
  if p_window_seconds < 1 or p_limit < 0 then raise exception 'invalid rate limit'; end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into rate_limits as r (key, route, window_start, count, blocked)
  values (p_key, p_route, v_window, 1, case when 1 > p_limit then 1 else 0 end)
  on conflict (key, route, window_start) do update
    set count = r.count + 1, blocked = r.blocked + case when r.count + 1 > p_limit then 1 else 0 end
  returning r.count into v_count;
  return query select v_count <= p_limit, v_count;
end; $$;
revoke all on function rate_limit_hit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function rate_limit_hit(text,text,integer,integer) to service_role;

create or replace function rate_limit_blocked_last_hour()
returns integer
language sql security definer set search_path = public as $$
  select coalesce(sum(blocked), 0)::integer from rate_limits where window_start >= now() - interval '1 hour';
$$;
revoke all on function rate_limit_blocked_last_hour() from public, anon, authenticated;
grant execute on function rate_limit_blocked_last_hour() to service_role;
