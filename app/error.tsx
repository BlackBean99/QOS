"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the user-facing message generic. Runtime diagnostics stay in the local console.
    console.error("QOS route render failed", error.digest ?? "no-digest");
  }, [error]);

  return (
    <main className="fatal-error" role="alert">
      <p className="eyebrow">RECOVERABLE ERROR</p>
      <h1>화면을 불러오지 못했습니다.</h1>
      <p>입력 내용이나 비밀을 로그에 표시하지 않습니다. 로컬 서버 상태를 확인해 주세요.</p>
      <button className="primary-button" type="button" onClick={reset}>
        다시 시도
      </button>
    </main>
  );
}
