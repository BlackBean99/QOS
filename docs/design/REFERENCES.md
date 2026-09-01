# Design references

## Research status

- 확인일: 2026-08-22
- 목적: QOS의 “정교한 금융 터미널 + 영화적인 디지털 에디토리얼” 방향에 적용할
  시각화, 내비게이션과 서사 원리를 찾는다.
- 방법: 공식 수상 갤러리와 공개된 실제 작품을 우선 확인했다. 작품의 소스, 레이아웃,
  애셋이나 브랜드 표현은 복제하지 않는다.
- 제한: Awwwards의 Sites of the Year 목록은 조사 시점에 요청 timeout이 발생했고
  FWA 홈은 정적 본문을 노출하지 않았다. 두 갤러리는 후보 출처로 유지하되, 주요
  화면 구현 전 실제 브라우저에서 다시 검증한다.

## Compared official sources

- [Upbit public exchange chart](https://www.upbit.com/exchange?code=CRIX.UPBIT.KRW-BTC):
  2026-08-25 실제 Chromium에서 `지표 및 전략` catalog, drawing toolbar, 기간 전환과
  chart controls를 확인했다. QOS는 이 공개 상호작용을 기능 참고점으로 사용하며 Upbit나
  TradingView의 source, 브랜드·레이아웃과 라이선스 전용 기능은 복제하지 않는다.

- [Webby Awards — Websites & Mobile Sites 2026](https://winners.webbyawards.com/winners/websites-and-mobile-sites):
  2026 수상 부문과 작품을 확인했다. 데이터 시각화, 홈페이지, UX, 모바일을 분리해
  평가하므로 제품 원리별 후보 선정에 가장 직접적이다.
- [CSS Design Awards — 2025 WOTY winners](https://cssdesignawards.com/blog/2025-website-of-the-year-winners/430/):
  2026-02-12 발표된 2025 WOTY 및 UI/UX/Innovation 부문을 확인했다.
- [CSS Design Awards — July 2026 nominees](https://cssdesignawards.com/blog/website-of-the-month-2026-july/436/):
  조사 시점에 공개된 최신 월간 후보를 확인했다. 후보는 최종 수상작으로 오인하지 않는다.
- [Awwwards — Sites of the Year](https://www.awwwards.com/websites/sites_of_the_year/):
  공식 우선 조사처. timeout으로 개별 작품 관찰을 완료하지 못했다.
- [FWA](https://thefwa.com/): 공식 우선 조사처. 동적 콘텐츠 제한으로 개별 작품
  관찰을 완료하지 못했다.

## Candidate works

### Webby 2026 / WWF — Protecting Blue Corridors

- 출처/작품: [Webby recognition](https://winners.webbyawards.com/2026/websites-and-mobile-sites/features-design/best-data-visualization/364937/wwf--blue-corridors),
  [live work](https://bluecorridors.org/)
- 확인일: 2026-08-22
- 강점: 31년 데이터, 태그 수, 이동 거리 같은 핵심 수치를 앞에 두고, 종별 이동 경로,
  위협, 보호 우선순위를 한 지도 탐색 구조로 나눈다. 데이터 출처와 협력 기관도 노출한다.
- 이 제품에 적용할 원리: 백테스트 요약 수치에서 상세 종목/기간/비용 레이어로 점진적으로
  내려가게 하고, 차트와 함께 데이터 출처·범위·가정을 항상 찾을 수 있게 한다.
- 채택하지 않을 요소: 지도 중심 공간 탐색, 자연 사진 연출과 장식적 장시간 스크롤을
  핵심 전략/주문 화면에 이식하지 않는다.

### Webby 2026 / Searching for Birds

- 출처/작품: [Webby recognition](https://winners.webbyawards.com/2026/websites-and-mobile-sites/features-design/best-data-visualization/384216/searching-for-birds),
  [live work](https://searchingforbirds.visualcinnamon.com/)
- 확인일: 2026-08-22
- 강점: 약 700개 항목을 형태→유형→종으로 단계적으로 펼치고, 서사 문장과 접근 가능한
  차트 설명, 선·색·패턴을 함께 사용한다. pinch/pan/hover/click 대안도 텍스트로 알린다.
- 이 제품에 적용할 원리: 포트폴리오와 기여도는 overview→그룹→종목으로 drill-down하고,
  각 차트에 해석 문장, 명시적 단위, 패턴/라벨과 모바일 제스처 안내를 제공한다.
- 채택하지 않을 요소: 긴 읽기 흐름과 스크롤 종속 전환을 고빈도 대시보드 및 주문 화면에
  사용하지 않는다.

### Webby 2026 / Spotify Wrapped Product Experience

- 출처/작품: [Webby Best Data Visualization 2026 gallery](https://winners.webbyawards.com/winners/websites-and-mobile-sites/features-design/best-data-visualization)
- 확인일: 2026-08-22
- 강점: 개인 데이터를 기억하기 쉬운 순서와 공유 가능한 단위로 재구성하는 후보 사례다.
- 이 제품에 적용할 원리: 전략 결과 공유 화면에서 기간, 핵심 성과, 위험, 비용, 가장 큰
  손실 구간을 짧은 카드 서사로 요약하되 원본 분석으로 돌아가는 링크를 둔다.
- 채택하지 않을 요소: 결과 과장, 자동재생, 연속 모션, 손실/위험을 가리는 축하 톤과
  브랜드 색의 직접 모방.

### Webby 2026 / The Renaissance Edition

- 출처/작품: [Webby recognition](https://winners.webbyawards.com/2026/websites-and-mobile-sites/features-design/best-home-page/372642/the-renaissance-edition)
- 확인일: 2026-08-22
- 강점: Best Home Page와 Best Visual Design — Aesthetic에서 함께 인정받은, 감성적
  홈페이지 서사를 검토할 후보다.
- 이 제품에 적용할 원리: 랜딩과 온보딩에서만 큰 display type, 충분한 여백과 절제된
  비대칭을 사용하고 앱 진입 CTA와 신뢰/안전 설명을 명확히 유지한다.
- 채택하지 않을 요소: 금융 판단 화면의 편집적 그리드 파괴, 읽기를 늦추는 장면 전환,
  실제 제품 상태보다 분위기를 우선하는 연출.

### Webby 2026 / Google Gemini Marketing Site

- 출처/작품: [Webby recognition](https://winners.webbyawards.com/2026/ai/ai-experiences-applications/consumer-application/381647/google-gemini-marketing-site),
  [live work](https://gemini.google/)
- 확인일: 2026-08-22
- 강점: AI Consumer Application 수상과 Best User Experience Honoree를 함께 받은,
  복잡한 AI 기능을 사용자 과업 중심으로 설명하는 후보 사례다.
- 이 제품에 적용할 원리: “LLM이 무엇을 할 수 있는가”보다 전략 작성→구조 확인→검증
  결과의 사용자 과업을 먼저 보여주고, 모델 한계와 사용자 확인 단계를 가까이 둔다.
- 채택하지 않을 요소: 범용 AI 브랜드 표현, 무한한 가능성을 암시하는 카피, 모델
  정확성이나 투자 성과를 보장하는 듯한 표현.

### CSSDA 2025 / Dropbox Brand

- 출처/작품: [CSSDA WOTY winners](https://cssdesignawards.com/blog/2025-website-of-the-year-winners/430/),
  [live work](https://brand.dropbox.com/)
- 확인일: 2026-08-22
- 강점: WOTY 2025와 Best UX를 함께 받은 사례로, 큰 브랜드 자산 집합을 찾기 쉬운
  체계로 제공하는 방식을 검토할 후보다.
- 이 제품에 적용할 원리: 전략, 데이터, 실행과 위험 관련 디자인/용어 규칙을 한 토큰과
  컴포넌트 체계로 묶고 검색·스캔 가능한 문서 구조를 유지한다.
- 채택하지 않을 요소: Dropbox의 색, 타이포, 일러스트, 레이아웃이나 브랜드 어조 복제.

## Direction for QOS

- 데이터 화면은 조밀하지만 숫자→비교→원인→가정 순의 계층을 유지한다.
- 랜딩·온보딩·공유 화면에만 에디토리얼 서사를 허용하고 전략/백테스트/주문 화면은
  안정적인 터미널 그리드를 쓴다.
- 배경/표면/텍스트/상승/하락/위험/강조, display/title/body/label/number를 토큰화한다.
- 색만으로 상승·하락·위험을 구분하지 않고 부호, 문구, 아이콘, 패턴과 라벨을 병용한다.
- 주요 화면 구현 전에 Awwwards·FWA 및 실제 후보를 390px/1440px 브라우저에서 다시
  확인하고, 채택/기각 기록을 이 문서에 갱신한다.
