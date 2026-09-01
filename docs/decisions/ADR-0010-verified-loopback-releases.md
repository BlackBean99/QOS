# ADR-0010: Verified loopback releases before MVP

## Status

Accepted

## Date

2026-09-01

## Context

QOS는 MVP 완료 전 한 대의 Mac에서 사용하는 인증 없는 단일 사용자 앱이다. 최신 개발사항을
반복해서 production mode로 실행할 수 있어야 하지만, 현재 mutation API와 Supabase service-role
경계는 공개 인터넷에 노출할 준비가 되지 않았다. 수동 `next start`는 어떤 source/commit이
실행 중인지, 전체 품질 게이트를 통과했는지, 종료 대상 PID가 QOS인지 재현하기 어렵다.

## Decision

- MVP 완료 전 release target은 이 저장소가 실행되는 Mac의 `127.0.0.1`뿐이다. npm registry
  publication, anonymous preview와 remote hosting은 release 자동화에 포함하지 않는다.
- `npm run release:local`을 공식 release entrypoint로 둔다. 관리 중인 QOS 서버를 안전하게
  종료하고 format, lint, typecheck, Vitest, production build, production dependency audit와
  Playwright E2E를 모두 통과한 경우에만 이미 생성된 build를 시작한다.
- `npm run deploy:local`은 개발 중 빠른 production build/restart, `deploy:local:status`와
  `deploy:local:stop`은 상태 확인과 종료에 사용한다.
- 서버는 Node가 저장소의 Next binary를 `start -H 127.0.0.1`로 실행한다. 상태는 Git에서 제외된
  `.qos/runtime/local-production.json`, 로그는 mode `0600` 파일에 보관한다.
- 종료 소유권은 server/monitor 각각의 repository root/PID/start time과 실제 process cwd/name/
  command를 대조하고, 정상 server는 listener까지 확인한다. 이미 listener를 잃은 server는 저장된
  PID/start time/cwd/Next process identity가 모두 일치할 때만 복구 종료한다.
- local release는 Next server와 별도 monitor worker를 함께 시작한다. worker가 새 heartbeat를
  기록하고 repository-local `tsx scripts/live-monitor.ts` command인지 확인한 뒤에만 state v2를
  기록한다. 기존 server-only state v1은 rollback/종료 호환을 유지한다.
- 배포 성공은 `/`, 전체 42 Entry·8 Filter·20 Exit catalog와 다중 Entry deterministic compiler
  결과를 제한시간 안에 확인한 뒤에만 기록한다. 상태에는 Git commit과 dirty 여부를 남긴다.

## Alternatives considered

### 수동 `npm run build && npm run start`

가장 단순하지만 gate, health, PID 소유권, 상태와 반복 가능한 restart가 없어 공식 release로는
채택하지 않았다. 비상 진단 명령으로는 계속 사용할 수 있다.

### GitHub Actions 또는 원격 hosting 자동 배포

Mac과 무관하게 재현 가능하지만 현재 인증 없는 mutation API를 공개하고 hosting credential과
접근 제어 결정을 앞당긴다. MVP 완료 전 경계와 맞지 않아 보류한다.

### npm registry package publish

QOS는 설치형 library가 아닌 단일 Next.js application이다. registry publish는 실행 중인 로컬
서비스를 갱신하지 않으며 package 공개와 versioning 부담만 추가하므로 채택하지 않았다.

### 범용 process manager dependency

자동 재시작과 로그 회전은 제공하지만 한 프로세스의 MVP 개발 환경에 새 전역/production 운영
계층을 추가할 근거가 부족하다. 현재는 Node 표준 API와 macOS `ps`/`lsof`로 범위를 제한한다.

## Consequences and risks

- 한 명령으로 최신 작업 트리를 검증하고 로컬 production을 재현할 수 있다.
- 관리 상태가 없는 프로세스나 다른 저장소의 PID를 자동 종료하지 않는다. server 또는 monitor
  어느 한쪽의 소유권이 불명확하면 먼저 어떤 PID도 종료하지 않는다.
- release gate가 실패하면 서버는 stopped 상태다. 원인을 수정해 같은 명령을 다시 실행하거나,
  필요하면 알려진 정상 commit을 별도 worktree에서 build/release하는 것이 rollback 경로다.
- Mac 재시작 후 stale state는 PID가 존재하지 않을 때만 정리된다. 로그 회전과 부팅 시 자동 시작은
  제공하지 않는다.
- `deploy:local`은 전체 gate가 아닌 빠른 경로이며 상태의 `dirty`가 true일 수 있다. 공유 가능한
  release 증거는 `release:local` 결과와 clean Git commit을 함께 사용한다.
- loopback binding은 같은 Mac의 다른 local user/process에 대한 인증을 제공하지 않는다. 이 앱을
  공용 기기에서 실행하거나 tunnel/port-forward로 노출하면 안 된다.

## Revisit when

- MVP 완료를 선언하거나 다른 기기/사용자에게 접근을 제공해야 할 때
- 인증, owner-scoped RLS, secret rotation과 배포 환경 접근 제어가 설계·검증됐을 때
- 자동 재시작, 로그 회전 또는 운영 관측성이 반복적으로 필요해 process supervisor 도입 근거가
  생겼을 때
