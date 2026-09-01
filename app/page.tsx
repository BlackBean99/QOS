import { MarketWorkspace } from "@/src/components/market-workspace";

function MarketPulse({ market, value }: { market: string; value: string }) {
  return (
    <span className="market-pulse">
      <span>{market}</span>
      <span aria-label={`${market} 시장 데이터 공급자 ${value}`}>{value}</span>
    </span>
  );
}

export default function Home() {
  return (
    <main className="app-shell">
      <a className="skip-link" href="#market-search">
        종목 검색으로 건너뛰기
      </a>

      <header className="site-header">
        <a className="wordmark" href="#market-search" aria-label="QOS 리서치 데스크 홈">
          <span className="wordmark-mark" aria-hidden="true">
            Q
          </span>
          <span className="wordmark-copy">
            <strong>QOS</strong>
            <small>QUANT RESEARCH DESK</small>
          </span>
        </a>
        <div className="market-strip" aria-label="사용 가능한 실제 시장 데이터 공급자">
          <MarketPulse market="KR" value="TOSS" />
          <MarketPulse market="US" value="TOSS" />
        </div>
        <nav className="site-nav" aria-label="워크스페이스 바로가기">
          <a href="#market-search">종목</a>
          <a href="#automation">자동화</a>
          <a href="#strategy-library">라이브러리</a>
        </nav>
        <div className="mode-badge">
          <span className="status-dot" aria-hidden="true" />
          PAPER RESEARCH
        </div>
      </header>

      <MarketWorkspace />

      <footer className="site-footer">
        <span>QOS / LOCAL QUANT OPERATIONS</span>
        <span>실제 주문 없음 · 결과는 투자 조언이 아닙니다.</span>
      </footer>
    </main>
  );
}
