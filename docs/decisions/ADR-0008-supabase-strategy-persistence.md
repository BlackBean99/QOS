# ADR-0008: Supabase strategy persistence and backtest history

## Status

Accepted — 2026-08-25; supersedes ADR-0006 as the configured production persistence adapter.

## Context

전략 library가 process-local `.qos/data/strategies.json`만 사용해 다른 실행 위치·프로세스와
공유되지 않고, backtest 결과 이력도 남지 않았다. 사용자가 Supabase server credential과
원격 DB 사용을 승인했다. 제품은 여전히 인증 없는 로컬 단일 사용자이며 공개 배포는 범위 밖이다.

## Decision

- Supabase Postgres의 `qos_strategies`, `qos_backtest_runs`를 primary persistence로 사용한다.
- Next server가 `SUPABASE_SECRET_KEY` 또는 legacy `SUPABASE_SERVICE_ROLE_KEY`를 읽어 Data API를
  호출한다. publishable/anon key로 전략 mutation을 열지 않는다.
- 두 테이블에 RLS를 활성화하되 anon/authenticated policy는 만들지 않고 service role만 grant한다.
- 전략 JSON과 외부 DB 응답은 기존 strict Zod schema로 검증하고 revision filter로 optimistic
  concurrency를 지킨다.
- 전략별/전체 history 목록은 summary-only, 단건은 full result를 반환해 payload를 제한한다.
- Supabase env가 비어 있는 테스트·local setup만 기존 file adapter를 사용한다. 구성된 remote
  장애를 silent fallback하지 않는다.
- 전략은 최대 500개, portable JSON은 5MiB로 제한하고 DB counter row가 count와 serialized bytes를
  원자적으로 갱신한다. remote import는 reject/clone만 지원하며 revision predicate 없는 replace는
  거부한다.

## Alternatives considered

- browser에서 anon key를 쓰는 방식은 인증·owner policy가 없는 현재 제품에서 누구나 CRUD할 수
  있어 제외했다.
- local JSON 유지 방식은 단일 machine 밖 persistence와 run history 요구를 충족하지 못한다.
- 새 ORM/DB client dependency는 두 테이블의 단순 Data API 계약에 비해 필요성이 없어 추가하지
  않고 표준 `fetch` adapter를 사용한다.

## Consequences and recovery

Supabase availability와 migration이 전략 CRUD의 운영 전제가 된다. 장애는 사용자에게 명시하고
local divergent write를 만들지 않는다. migration은 additive이며 rollback은 두 table을 export한
뒤 명시적으로 drop하는 수동 절차다. 전략 삭제는 history row를 보존하고 `strategy_id`만 null로
바꾸며 전체 history endpoint에서 계속 발견할 수 있다. 공개 배포 전에는 Supabase Auth와
owner-scoped RLS를 새 ADR로 설계해야 한다.

구성된 project에 QOS 밖의 기존 migration history가 있었으므로 해당 원격 버전은 명시적인 no-op
marker로 보존한다. marker는 타 앱 schema를 재현하는 baseline이 아니며 QOS는 그 schema를
재구성하거나 remote history를 repair하지 않는다. 세부 경계는 migration README에 둔다.
dry-run이 의도한 새 QOS migration만 선택할 때만 push한다.

## Sources

- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/guides/api/quickstart
