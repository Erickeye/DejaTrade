// 網頁版的加密貨幣資料：由「使用者的瀏覽器」直接向 Binance 公開行情端點抓取 1 分鐘 K 線，
// 我們不儲存、不轉散布資料。標的與日期由種子決定（每日挑戰所有人相同）。
import { createRng } from '../engine'
import type { DayFile } from '../engine'

/** Binance 的「僅行情」公開端點 */
export const BINANCE_ENDPOINT = 'https://data-api.binance.vision/api/v3/klines'
export const LIVE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const
/** 可抽的日期範圍（UTC）：起點固定，終點為「前天」以確保整天資料已完成 */
export const LIVE_FROM = '2023-01-01'
const MIN_CANDLES = 1380
const MIN_RANGE_PCT = 0.8

export const liveEnabled = (): boolean => import.meta.env.VITE_LIVE_CRYPTO === '1'

type Kline = [number, string, string, string, string, string, ...unknown[]]

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d

/** Binance K 線 → 與靜態資料相同的 DayFile；資料不足或波動太小回傳 null */
export function buildLiveDay(rows: Kline[], symbol: string, dateStr: string): DayFile | null {
  const start = Date.parse(dateStr + 'T00:00:00Z')
  const r = rows
    .map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
    .filter((x) => x.t >= start && x.t < start + 86_400_000 && Number.isFinite(x.o + x.h + x.l + x.c))
  if (r.length < MIN_CANDLES) return null
  const hi = Math.max(...r.map((x) => x.h)), lo = Math.min(...r.map((x) => x.l))
  if (((hi - lo) / r[0]!.o) * 100 < MIN_RANGE_PCT) return null
  const scale = r[0]!.o
  const k = 100 / scale
  return {
    id: `live-${symbol}-${dateStr}`,
    asset: 'crypto',
    interval: '1m',
    meta: { symbol, date: dateStr, scale },
    candles: r.map((x) => [(x.t - start) / 1000, round(x.o * k, 4), round(x.h * k, 4), round(x.l * k, 4), round(x.c * k, 4), round(x.v, 2)]),
  }
}

async function fetchRange(symbol: string, startTime: number, endTime: number, signal?: AbortSignal): Promise<Kline[]> {
  const url = `${BINANCE_ENDPOINT}?symbol=${symbol}&interval=1m&startTime=${startTime}&endTime=${endTime}&limit=1000`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`)
  return (await res.json()) as Kline[]
}

/** 抓一整天（1440 根，分兩次請求，每次最多 1000 根） */
export async function fetchLiveDay(symbol: string, dateStr: string, signal?: AbortSignal): Promise<DayFile | null> {
  const start = Date.parse(dateStr + 'T00:00:00Z')
  const mid = start + 720 * 60_000
  const [a, b] = await Promise.all([fetchRange(symbol, start, mid - 1, signal), fetchRange(symbol, mid, start + 86_400_000 - 1, signal)])
  return buildLiveDay([...a, ...b], symbol, dateStr)
}

/** 以種子決定日期（UTC，介於 LIVE_FROM 與前天之間） */
export function liveDateFor(rand: () => number, now = Date.now()): string {
  const from = Date.parse(LIVE_FROM + 'T00:00:00Z')
  const to = Math.floor(now / 86_400_000) * 86_400_000 - 2 * 86_400_000
  const days = Math.floor((to - from) / 86_400_000) + 1
  return new Date(from + Math.floor(rand() * days) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * 依種子抽一天並下載；遇到資料不足 / 波動太小的日子會換一天，最多重試 attempts 次。
 * 全部失敗（網路 / CORS 被擋）時丟出錯誤，由呼叫端決定如何退回。
 */
export async function pickLiveDay(symbol: string, seed: number, attempts = 6, now = Date.now()): Promise<DayFile> {
  const rand = createRng(seed)
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    const date = liveDateFor(rand, now)
    try {
      const day = await fetchLiveDay(symbol, date)
      if (day) return day
    } catch (e) {
      lastErr = e
      if (i >= 1) break // 連續網路錯誤就不要一直重試
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('找不到合適的交易日')
}
