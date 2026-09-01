begin;

-- Serialize the recount against strategy INSERT/UPDATE/DELETE statements. Without this lock a
-- concurrent trigger increment could commit between the SELECT and counter UPDATE and be lost.
lock table public.qos_strategies in share row exclusive mode;

do $$
declare
  actual_count bigint;
  actual_bytes bigint;
begin
  select count(*), coalesce(sum(public.qos_strategy_portable_bytes(strategy_row)), 0)
    into actual_count, actual_bytes
    from public.qos_strategies as strategy_row;

  if actual_count > 500 or actual_bytes > 5176320 then
    raise exception using
      errcode = 'P0001',
      message = 'qos_strategy_export_budget_requires_remediation',
      detail = format('count=%s bytes=%s limit=500/5176320', actual_count, actual_bytes);
  end if;

  update public.qos_strategy_limits
    set strategy_count = actual_count,
        strategy_bytes = actual_bytes
    where singleton = true;
end;
$$;

commit;
