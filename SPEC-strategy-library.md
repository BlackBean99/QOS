# SPEC: strategy-library

## Contract

전략 문서에는 `id`, `revision`, `name`, `description`, `strategy`, `instrument` snapshot,
`chart`, `monitor`, `createdAt`, `updatedAt`을 둔다. chart에는 period, indicators, drawings와
view 설정만 저장하며 provider credential이나 Telegram chat 식별자는 포함하지 않는다.

서버는 Supabase Postgres의 `qos_strategies`를 primary store로 사용한다. service-role/secret key는
Next.js Node server에서만 읽고 browser bundle, JSON export와 log에는 포함하지 않는다. 환경이
구성되지 않은 개발·테스트에서는 기존 `.qos/data/strategies.json` adapter를 명시적 local mode로
유지한다. 구성된 Supabase 장애를 local fallback으로 숨기지 않는다.

create/list/read/update/delete와 단일·다중 JSON import/export를 지원한다. update/delete는 id와
revision을 같은 mutation filter에 넣어 stale write를 원자적으로 거부한다. Data API 응답은
strict schema로 다시 검증한다. remote import는 `reject`와 `clone`만 허용하고 revision을 우회하는
bulk replace는 거부한다. portable document는 5MiB, 저장 개수는 500개이며 DB counter row가
count/bytes를 함께 갱신해 concurrent mutation에도 한도를 넘지 않는다.

## Backtest history

저장 전략의 실행은 `POST /api/strategies/:id/backtests`가 현재 revision을 불러와 TOSS dataset으로
paper backtest하고 성공 결과를 `qos_backtest_runs`에 snapshot으로 남긴다. 전략 삭제 후에도
연구 감사가 가능하도록 run은 전략 이름·revision·전략·종목 snapshot과 engine version을 보존하고
foreign key는 `ON DELETE SET NULL`이다.

- `GET /api/strategies/:id/backtests?limit=1..50`: 최신 summary 목록
- `GET /api/backtest-runs?limit=1..50`: 삭제된 전략을 포함한 전체 최신 summary 목록
- `GET /api/backtest-runs/:id`: full result와 snapshot
- `DELETE /api/backtest-runs/:id`: 단일 history 삭제
- 목록 응답은 대형 chart series를 제외하고 full result는 단건 조회에서만 반환한다.

## Acceptance criteria

- 재시작 후에도 전략과 차트 설정이 유지된다.
- strict schema 밖의 필드, 중복 id, 과대 문서, 잘못된 drawing point를 거부한다.
- export는 secret 없는 portable JSON이며 import는 전체 검증 뒤 원자적으로 반영된다.
- 저장 전략을 읽기 전용 view로 확인하고 즉시 backtest 또는 monitor 전환이 가능하다.
- provider 검색 전이나 장애 중에도 저장 전략을 조회/export하고 snapshot으로 workspace를
  복원할 수 있다.
- 저장 전략 backtest가 history에 남고 전략별/전체 목록→상세 조회→삭제가 재시작 뒤에도
  유지된다. 전략 삭제 뒤에도 snapshot은 전체 이력에서 발견할 수 있다.
- mutation 성공과 후속 목록 동기화 실패를 구분해 성공한 create/import의 중복 재시도를 막는다.
- Supabase key/table/timeout/429/5xx/invalid response는 안전한 503/502 오류로 노출되고 secret은
  client 또는 log에 나타나지 않는다.
- Supabase schema는 versioned migration으로 재현되고 RLS가 켜진 상태에서 browser role에는
  policy를 열지 않는다.
