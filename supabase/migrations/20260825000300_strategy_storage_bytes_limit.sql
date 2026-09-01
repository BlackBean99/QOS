begin;

alter table public.qos_strategy_limits
  add column if not exists strategy_bytes bigint not null default 0
  check (strategy_bytes between 0 and 5242880);

update public.qos_strategy_limits
set strategy_bytes = coalesce(
  (select sum(octet_length(to_jsonb(strategy_row)::text)) from public.qos_strategies strategy_row),
  0
)
where singleton = true;

create or replace function public.reserve_qos_strategy_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.qos_strategy_limits
  set strategy_count = strategy_count + 1,
      strategy_bytes = strategy_bytes + octet_length(to_jsonb(new)::text)
  where singleton = true
    and strategy_count < 500
    and strategy_bytes + octet_length(to_jsonb(new)::text) <= 5242880;
  if not found then
    raise exception using errcode = 'P0001', message = 'qos_strategy_storage_limit';
  end if;
  return new;
end;
$$;

create or replace function public.resize_qos_strategy_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.qos_strategy_limits
  set strategy_bytes = strategy_bytes
    - octet_length(to_jsonb(old)::text)
    + octet_length(to_jsonb(new)::text)
  where singleton = true
    and strategy_bytes
      - octet_length(to_jsonb(old)::text)
      + octet_length(to_jsonb(new)::text) <= 5242880;
  if not found then
    raise exception using errcode = 'P0001', message = 'qos_strategy_storage_limit';
  end if;
  return new;
end;
$$;

create or replace function public.release_qos_strategy_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.qos_strategy_limits
  set strategy_count = greatest(0, strategy_count - 1),
      strategy_bytes = greatest(0, strategy_bytes - octet_length(to_jsonb(old)::text))
  where singleton = true;
  return old;
end;
$$;

revoke all on function public.resize_qos_strategy_slot() from public, anon, authenticated;
grant execute on function public.resize_qos_strategy_slot() to service_role;

drop trigger if exists qos_strategies_resize_slot on public.qos_strategies;
create trigger qos_strategies_resize_slot
before update on public.qos_strategies
for each row execute function public.resize_qos_strategy_slot();

commit;
