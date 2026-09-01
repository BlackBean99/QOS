begin;

create or replace function public.qos_compact_json(value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  content text;
begin
  case jsonb_typeof(value)
    when 'object' then
      select coalesce(
        string_agg(to_jsonb(entry.key)::text || ':' || public.qos_compact_json(entry.value), ',' order by entry.key),
        ''
      )
      into content
      from jsonb_each(value) as entry;
      return '{' || content || '}';
    when 'array' then
      select coalesce(
        string_agg(public.qos_compact_json(item.value), ',' order by item.ordinality),
        ''
      )
      into content
      from jsonb_array_elements(value) with ordinality as item(value, ordinality);
      return '[' || content || ']';
    else
      return value::text;
  end case;
end;
$$;

create or replace function public.qos_strategy_portable_bytes(strategy_row public.qos_strategies)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select octet_length(
    public.qos_compact_json(
      strategy_row.document || jsonb_build_object(
        'id', strategy_row.id,
        'revision', strategy_row.revision,
        'createdAt', strategy_row.created_at,
        'updatedAt', strategy_row.updated_at
      )
    )
  )::bigint;
$$;

update public.qos_strategy_limits
set strategy_bytes = coalesce(
  (select sum(public.qos_strategy_portable_bytes(strategy_row)) from public.qos_strategies strategy_row),
  0
)
where singleton = true;

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
    and strategy_bytes + added_bytes <= 5242880;
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
    and strategy_bytes - old_bytes + new_bytes <= 5242880;
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
      strategy_bytes = greatest(
        0,
        strategy_bytes - public.qos_strategy_portable_bytes(old)
      )
  where singleton = true;
  return old;
end;
$$;

revoke all on function public.qos_compact_json(jsonb) from public, anon, authenticated;
revoke all on function public.qos_strategy_portable_bytes(public.qos_strategies) from public, anon, authenticated;
grant execute on function public.qos_compact_json(jsonb) to service_role;
grant execute on function public.qos_strategy_portable_bytes(public.qos_strategies) to service_role;

commit;
