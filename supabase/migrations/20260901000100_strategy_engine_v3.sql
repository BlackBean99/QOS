begin;

alter table public.qos_strategies
  drop constraint if exists qos_strategies_timeframe_check;
alter table public.qos_strategies
  add constraint qos_strategies_timeframe_check
  check (timeframe in ('1m', '5m', '15m', '30m', '60m', '4h', '1d', '1w'));

alter table public.qos_backtest_runs
  drop constraint if exists qos_backtest_runs_strategy_version_check;
alter table public.qos_backtest_runs
  add constraint qos_backtest_runs_strategy_version_check
  check (strategy_version in (1, 2, 3));

alter table public.qos_backtest_runs
  drop constraint if exists qos_backtest_runs_timeframe_check;
alter table public.qos_backtest_runs
  add constraint qos_backtest_runs_timeframe_check
  check (timeframe in ('1m', '5m', '15m', '30m', '60m', '4h', '1d', '1w'));

commit;
