begin;

-- The public 5MiB transfer budget reserves 64KiB for request wrapping. Keep a further 1KiB
-- inside that document budget for the export envelope, 499 commas and timestamp representation.
create or replace function public.reserve_qos_strategy_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  added_bytes bigint := public.qos_strategy_portable_bytes(new);
begin
  update public.qos_strategy_limits
  set strategy_count = strategy_count + 1,
      strategy_bytes = strategy_bytes + added_bytes
  where singleton = true
    and strategy_count < 500
    and strategy_bytes + added_bytes <= 5176320;
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
declare
  old_bytes bigint := public.qos_strategy_portable_bytes(old);
  new_bytes bigint := public.qos_strategy_portable_bytes(new);
begin
  update public.qos_strategy_limits
  set strategy_bytes = strategy_bytes - old_bytes + new_bytes
  where singleton = true
    and strategy_bytes - old_bytes + new_bytes <= 5176320;
  if not found then
    raise exception using errcode = 'P0001', message = 'qos_strategy_storage_limit';
  end if;
  return new;
end;
$$;

commit;
