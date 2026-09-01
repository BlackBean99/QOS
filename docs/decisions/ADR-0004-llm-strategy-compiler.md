# ADR-0004: Optional OpenAI strategy compiler behind strict validation

## 2026-08-25 비용 경계 보완

Codex/ChatGPT 로그인 세션은 이 애플리케이션의 런타임 인증수단으로 재사용하지 않는다.
기본 구성은 `OPENAI_API_KEY`가 비어 있으며 외부 OpenAI API 요청과 별도 API 비용이 없다.
검증된 reference 문장은 로컬 template로만 Strategy v2 후보를 만든다. 사용자가 서버 환경에
API key를 직접 설정한 경우에만 별도 과금되는 OpenAI API adapter를 명시적 opt-in으로 켠다.
UI는 로컬 template을 LLM 변환으로 표시하지 않고 실제 compiler 출처와 비용 경계를 표시한다.

## Status

Accepted — 2026-08-22

## Context

자유로운 자연어를 기존 정규식 template만으로 지원할 수 없다. 반면 모델 출력을 곧바로
실행하면 prompt injection, schema drift, 비용과 재현성 위험이 있다. 저장소에는 외부 LLM
dependency와 credential이 없다.

## Decision

서버 전용 `OPENAI_API_KEY`가 있을 때 Responses API와 strict JSON Schema로 Strategy v2
후보를 만든다. `store: false`, 제한된 output token, attempt당 12초 timeout과 최대 2회 요청을
사용한다. 429/5xx는 `Retry-After`를 우선하되 대기 시간을 최대 1초로 제한하고, header가
없으면 250ms exponential backoff를 사용한다.
응답은 다시 Zod strict schema와 시장/종목 semantic validation을 통과해야 하며 UI에서
사용자가 확인하기 전에는 백테스트하지 않는다. 키가 없으면 외부 호출을 시도하지 않고
명시적인 unavailable 상태와 reference-template fallback을 반환한다.

## Alternatives considered

- Regex 확장만 사용: 자유로운 문장과 복합 청산 비교를 안정적으로 표현하지 못해 기각.
- 모델 생성 Python/Pine code 실행: 임의 코드 실행과 재현성 위험 때문에 금지.
- Provider-neutral user URL: SSRF와 호환성 표면이 커지고 provider가 아직 하나뿐이라 연기.
- SDK dependency 추가: 첫 adapter는 표준 `fetch`만으로 충분해 production dependency를 늘리지
  않는다.

## Consequences

- 키와 모델명은 서버 환경에만 존재한다.
- LLM이 없어도 fixture 연구와 빌드/테스트는 동작한다.
- 다른 provider와 실제 prompt retention/consent 정책은 새 ADR이 필요하다.
