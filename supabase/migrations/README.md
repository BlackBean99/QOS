# Supabase migration boundary

`20260407...`부터 `20260519...`까지의 `remote_baseline` 파일은 이 저장소가 소유하지 않는
기존 공유 project migration version과 로컬 CLI history를 정렬하는 **빈 marker**다. 해당 파일은
다른 애플리케이션의 schema를 재현하지 않으며 QOS도 그 schema에 의존하지 않는다.

QOS가 소유하고 clean project에서 재현해야 하는 schema는 `20260825...` migration부터 시작한다.
새 운영 환경에는 전용 Supabase project를 권장한다. 공유 project의 기존 schema까지 재현해야 할
경우에는 별도의 검토된 `supabase db pull` baseline이 필요하며, 이 빈 marker를 완전한 baseline으로
간주하면 안 된다.

`20260901000100_strategy_engine_v3.sql`은 저장 전략 timeframe을 `1m`~`1w`로 확장하고 immutable
backtest run의 `strategy_version = 3`을 허용하는 additive constraint migration이다. 기존 v1/v2
row와 table/column을 삭제하거나 재작성하지 않는다.
