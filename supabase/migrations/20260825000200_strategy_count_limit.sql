begin;

create table if not exists public.qos_strategy_limits (
  singleton boolean primary key default true check (singleton),
  strategy_count integer not null check (strategy_count between 0 and 500)
);

insert into public.qos_strategy_limits (singleton, strategy_count)
values (true, (select count(*)::integer from public.qos_strategies))
on conflict (singleton) do update
set strategy_count = excluded.strategy_count;

alter table public.qos_strategy_limits enable row level security;
revoke all on table public.qos_strategy_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.qos_strategy_limits to service_role;

create or replace function public.reserve_qos_strategy_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.qos_strategy_limits
  set strategy_count = strategy_count + 1
  where singleton = true and strategy_count < 500;
  if not found then
    raise exception using errcode = 'P0001', message = 'qos_strategy_count_limit';
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
  set strategy_count = greatest(0, strategy_count - 1)
  where singleton = true;
  return old;
end;
$$;

revoke all on function public.reserve_qos_strategy_slot() from public, anon, authenticated;
revoke all on function public.release_qos_strategy_slot() from public, anon, authenticated;
grant execute on function public.reserve_qos_strategy_slot() to service_role;
grant execute on function public.release_qos_strategy_slot() to service_role;

drop trigger if exists qos_strategies_reserve_slot on public.qos_strategies;
create trigger qos_strategies_reserve_slot
before insert on public.qos_strategies
for each row execute function public.reserve_qos_strategy_slot();

drop trigger if exists qos_strategies_release_slot on public.qos_strategies;
create trigger qos_strategies_release_slot
after delete on public.qos_strategies
for each row execute function public.release_qos_strategy_slot();

commit;
