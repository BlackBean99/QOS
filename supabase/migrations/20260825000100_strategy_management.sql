begin;

create table if not exists public.qos_strategies (
  id uuid primary key,
  revision bigint not null check (revision > 0),
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '' check (char_length(description) <= 500),
  instrument_id text not null check (char_length(instrument_id) between 1 and 80),
  market text not null,
  timeframe text not null check (timeframe in ('5m', '1d')),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (created_at <= updated_at)
);

create index if not exists qos_strategies_updated_at_idx
  on public.qos_strategies (updated_at desc);
create index if not exists qos_strategies_instrument_idx
  on public.qos_strategies (instrument_id, updated_at desc);

create table if not exists public.qos_backtest_runs (
  id uuid primary key,
  strategy_id uuid references public.qos_strategies(id) on delete set null,
  strategy_name text not null check (char_length(strategy_name) between 1 and 100),
  strategy_revision bigint not null check (strategy_revision > 0),
  strategy_version smallint not null check (strategy_version in (1, 2)),
  instrument_id text not null check (char_length(instrument_id) between 1 and 80),
  market text not null,
  timeframe text not null check (timeframe in ('5m', '1d')),
  engine_version text not null check (char_length(engine_version) between 1 and 40),
  strategy_snapshot jsonb not null check (jsonb_typeof(strategy_snapshot) = 'object'),
  instrument_snapshot jsonb not null check (jsonb_typeof(instrument_snapshot) = 'object'),
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists qos_backtest_runs_strategy_created_idx
  on public.qos_backtest_runs (strategy_id, created_at desc);
create index if not exists qos_backtest_runs_created_idx
  on public.qos_backtest_runs (created_at desc);

alter table public.qos_strategies enable row level security;
alter table public.qos_backtest_runs enable row level security;

revoke all on table public.qos_strategies from public, anon, authenticated;
revoke all on table public.qos_backtest_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.qos_strategies to service_role;
grant select, insert, update, delete on table public.qos_backtest_runs to service_role;

commit;
