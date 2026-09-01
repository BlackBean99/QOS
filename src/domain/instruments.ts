import { z } from "zod";

export const MarketSchema = z.enum([
  "KOSPI",
  "KOSDAQ",
  "KR_ETC",
  "NYSE",
  "NASDAQ",
  "AMEX",
  "US_ETC",
]);
export type Market = z.infer<typeof MarketSchema>;

const MARKET_ID_PATTERN = MarketSchema.options.join("|");
export const InstrumentIdSchema = z
  .string()
  .regex(new RegExp(`^(?:${MARKET_ID_PATTERN}):[A-Z0-9][A-Z0-9.-]{0,31}$`));
export type InstrumentId = z.infer<typeof InstrumentIdSchema>;

export const InstrumentSummarySchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    market: MarketSchema,
    symbol: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,31}$/),
    displayName: z.string().trim().min(1).max(160),
    currency: z.enum(["KRW", "USD"]),
    timezone: z.enum(["Asia/Seoul", "America/New_York"]),
    synthetic: z.boolean(),
    aliases: z.array(z.string().max(160)).max(20),
    securityType: z.string().max(60).optional(),
    isinCode: z.string().max(32).optional(),
  })
  .strict();
export type InstrumentSummary = z.infer<typeof InstrumentSummarySchema>;

const INSTRUMENTS: readonly InstrumentSummary[] = [
  {
    instrumentId: "NASDAQ:AAPL",
    market: "NASDAQ",
    symbol: "AAPL",
    displayName: "Apple",
    currency: "USD",
    timezone: "America/New_York",
    synthetic: true,
    aliases: ["apple", "애플"],
  },
  {
    instrumentId: "NASDAQ:NVDA",
    market: "NASDAQ",
    symbol: "NVDA",
    displayName: "NVIDIA",
    currency: "USD",
    timezone: "America/New_York",
    synthetic: true,
    aliases: ["nvidia", "엔비디아"],
  },
  {
    instrumentId: "KOSPI:005930",
    market: "KOSPI",
    symbol: "005930",
    displayName: "삼성전자",
    currency: "KRW",
    timezone: "Asia/Seoul",
    synthetic: true,
    aliases: ["samsung", "삼성전자", "삼성"],
  },
  {
    instrumentId: "KOSPI:000660",
    market: "KOSPI",
    symbol: "000660",
    displayName: "SK하이닉스",
    currency: "KRW",
    timezone: "Asia/Seoul",
    synthetic: true,
    aliases: ["sk hynix", "sk하이닉스", "하이닉스"],
  },
] as const;

function normalizeSearchTerm(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s._:-]+/g, "");
}

function toSummary(instrument: InstrumentSummary): InstrumentSummary {
  return {
    instrumentId: instrument.instrumentId,
    market: instrument.market,
    symbol: instrument.symbol,
    displayName: instrument.displayName,
    currency: instrument.currency,
    timezone: instrument.timezone,
    synthetic: instrument.synthetic,
    aliases: [...instrument.aliases],
    securityType: instrument.securityType,
    isinCode: instrument.isinCode,
  };
}

export function listInstruments(): InstrumentSummary[] {
  return INSTRUMENTS.map(toSummary);
}

export function searchInstruments(query: string, market?: Market): InstrumentSummary[] {
  const normalizedQuery = normalizeSearchTerm(query.trim());

  return INSTRUMENTS.filter((instrument) => {
    if (market && instrument.market !== market) return false;
    if (!normalizedQuery) return true;

    return [
      instrument.instrumentId,
      instrument.market,
      instrument.symbol,
      instrument.displayName,
      ...instrument.aliases,
    ].some((value) => normalizeSearchTerm(value).includes(normalizedQuery));
  }).map(toSummary);
}

export function getInstrumentDefinition(instrumentId: InstrumentId): InstrumentSummary {
  const instrument = INSTRUMENTS.find((candidate) => candidate.instrumentId === instrumentId);
  if (!instrument) throw new Error(`Unknown instrument: ${instrumentId}`);
  return toSummary(instrument);
}

export function instrumentMatchesMarket(instrumentId: InstrumentId, market: Market): boolean {
  return instrumentId.slice(0, instrumentId.indexOf(":")) === market;
}

export function isKoreanMarket(market: Market): boolean {
  return market === "KOSPI" || market === "KOSDAQ" || market === "KR_ETC";
}

export function getMarketDefaults(
  market: Market,
): Pick<InstrumentSummary, "currency" | "timezone"> {
  return isKoreanMarket(market)
    ? { currency: "KRW", timezone: "Asia/Seoul" }
    : { currency: "USD", timezone: "America/New_York" };
}
