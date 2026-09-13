# Architecture decision records

이 디렉터리는 되돌리기 어렵거나 여러 대안이 있는 채택된 결정을 보존한다.

## Adopted decisions

- [ADR-0001: Start with a single Next.js application](ADR-0001-single-nextjs-application.md)
- [ADR-0002: Use a bounded strategy contract and next-session fills](ADR-0002-strategy-and-backtest-contract.md)
- [ADR-0003: Select one stable instrument before backtesting](ADR-0003-instrument-selection-contract.md)
- [ADR-0004: Optional OpenAI strategy compiler behind strict validation](ADR-0004-llm-strategy-compiler.md)
- [ADR-0005: TOSS market data adapter and explicit monitor process](ADR-0005-toss-market-data-and-monitoring.md)
- [ADR-0006: Versioned local JSON strategy store](ADR-0006-versioned-local-json-store.md)
- [ADR-0007: KLineChart 10 for the interactive market chart](ADR-0007-klinechart-interactive-market-chart.md)
- [ADR-0008: Supabase strategy persistence and backtest history](ADR-0008-supabase-strategy-persistence.md)
- [ADR-0009: Strategy v3 rule chain and conservative execution](ADR-0009-strategy-v3-rule-chain-and-execution.md)
- [ADR-0010: Verified loopback releases before MVP](ADR-0010-verified-loopback-releases.md)
- [ADR-0011: Historical all-entry recommendation and efficient tracking](ADR-0011-historical-recommendation-and-efficient-tracking.md)
- [ADR-0012: Persistent instrument catalog and multi-target monitoring](ADR-0012-persistent-instrument-catalog-and-multi-target-monitoring.md)
- [ADR-0013: Monitor snapshot fallback and explicit paper hedge state](ADR-0013-monitor-snapshot-and-paper-hedge-state.md)

## Naming

`ADR-NNNN-short-title.md` 형식을 사용하고 기존 마지막 번호 다음을 선택한다. 결정이
바뀌어도 이전 ADR을 삭제하지 말고 새 ADR에서 `Superseded` 관계를 기록한다.

## Required format

```markdown
# ADR-NNNN: Title

## Status

Proposed | Accepted | Superseded by ADR-NNNN | Deprecated

## Date

YYYY-MM-DD

## Context

검토 가능한 제약, 요구사항과 결정이 필요한 이유.

## Decision

선택한 방식과 적용 경계.

## Alternatives considered

각 대안의 장점, 단점과 채택하지 않은 이유.

## Consequences and risks

얻는 점, 비용, 운영/보안/호환성 위험.

## Revisit when

결정을 재검토할 측정 가능한 조건.
```

## Decisions that require an ADR

- 프레임워크, 런타임, DB, 브로커, LLM·시장 데이터·브로커 공급자
- 데이터 모델, 전략 표현과 공개 API 계약
- 인증, 권한, 시크릿, 감사 방식
- 주문 실행, 재시도, 멱등성, reconciliation, 장애·복구 정책
- 성능과 복잡성의 중요한 절충

사소한 CSS 값, 일회성 버그 수정과 아직 선택하지 않은 대안은 ADR로 만들지 않는다.
