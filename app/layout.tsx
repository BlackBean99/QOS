import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./responsive.css";
import "./research-desk.css";

export const metadata: Metadata = {
  title: "Q-OS · Quant hypothesis lab",
  description: "TOSS 국내·미국 실제 시세로 전략을 저장·백테스트·감시하는 로컬 quant 도구",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
