# ADR-0006: Versioned local JSON strategy store

## Status

Accepted — 2026-08-23

## Context

MVP는 로컬 단일 사용자이고 별도 DB는 필요성이 입증되지 않았다. 전략·chart setting은
재시작 뒤 유지되어야 하며 import/export와 CRUD가 필요하다. 환경 파일에 사용자 문서를
섞거나 client localStorage만 사용하면 server monitor와 상태를 공유할 수 없다.

## Decision

`.qos/data` 아래 versioned JSON envelope를 사용한다. strict schema validation, process mutex,
temporary file write + atomic rename, `0600` 권한과 optimistic revision으로 갱신한다. 전략
export에는 provider secret, Telegram token/chat id와 runtime delivery state를 포함하지 않는다.
디렉터리는 git에서 제외한다.

## Alternatives considered

- browser localStorage는 server monitor가 읽을 수 없고 backup/permission 경계가 약하다.
- SQLite는 concurrency와 query에는 유리하지만 현재 document 수와 단일 writer 범위에는
  migration/운영 비용이 더 크다.
- hosted DB는 인증·네트워크·운영 경계를 불필요하게 추가한다.

## Consequences and risks

- single-machine/single-process writer 범위에서는 단순하고 복구 가능하다.
- 수평 확장, 다중 사용자와 여러 writer에는 적합하지 않으며 그 시점에 DB ADR과 migration이
  필요하다.
- 손상 파일은 덮어쓰지 않고 명시적 오류와 수동 backup/restore 경로를 제공한다.

## Revisit when

동시 writer, 다중 사용자, 검색/index, 원격 backup, 감사 보존 또는 10,000개 이상의 전략
문서가 필요해질 때 SQLite/서버 DB와 명시적 migration으로 재검토한다.
