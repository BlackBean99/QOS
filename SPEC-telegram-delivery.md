# SPEC: telegram-delivery

## Contract

봇 token은 `TELEGRAM_BOT_TOKEN` 서버 환경에서만 읽는다. 연결 API는 BotFather 설정을
확인하고 `/start` 같은 특정 command를 요구하지 않으며, 사용자가 봇 채팅에서 보낸 최신
private update 중 유일한 chat을 선택한다. chat id는 export되지 않는 `.qos/data/settings.json`
`0600` 파일에 저장한다.

메시지는 전략명, BUY/SELL, 종목명/symbol, 가격, 완성 봉 시각, 기간과 신호 이유를 포함한다.
HTML/Markdown interpolation은 사용하지 않고 plain text로 보내며 token/chat id는 로그에서
마스킹한다.

## Acceptance criteria

- 연결되지 않음, 후보 없음, 후보 여러 개, Telegram 429/5xx와 timeout을 명확히 구분한다.
- 사용자가 연결 테스트를 요청한 경우에만 테스트 메시지를 보낸다.
- 실제 신호와 Telegram delivery가 같은 idempotency key로 감사 가능하다.
