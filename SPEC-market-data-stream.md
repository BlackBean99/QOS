# SPEC: market-data-stream

## Contract

- `instrumentId`는 `<TOSS market>:<symbol>`이며 market은 KOSPI, KOSDAQ, KR_ETC,
  NYSE, NASDAQ, AMEX, US_ETC 중 하나다.
- 서버는 TOSS `GET /api/v1/stocks/all`을 시장별로 받아 일 단위 메모리 캐시하고 이름,
  영문명과 symbol을 로컬 검색한다. 기본 결과는 거래 가능한 보통주다.
- 캔들은 `GET /api/v1/candles`의 newest-first 응답을 검증하고 oldest-first 숫자 배열로
  정규화한다. 원본 통화·시간대·adjusted 여부를 함께 반환한다.
- live 체결은 `trade:kr`/`trade:us` 구독을 full-replace 방식으로 선언하고, REST 캔들을
  기준으로 진행 중 봉을 갱신한다. 신호 평가에는 완성된 봉만 사용한다.

## Errors

missing config, unauthorized/forbidden, rate-limited, timeout, invalid provider payload와
unavailable을 서로 다른 안전한 사용자 오류 코드로 반환한다. secret과 원문 인증 응답은
로그에 기록하지 않는다.

## Acceptance criteria

- 실제 TOSS 목록에서 국내·미국 종목을 이름/티커로 검색한다.
- 빈 검색은 인기 종목을 가장하는 synthetic 목록 대신 검색 안내를 표시한다.
- 1분·일봉 pagination, decimal 변환, 순서, 다음 cursor와 실패 경로가 테스트된다.
- 실시간 재연결, 구독 ack/reject와 lossy 특성이 관측 가능하다.
