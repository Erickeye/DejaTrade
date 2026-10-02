/** 單根 K 線。t 為距離該局開始的秒數；價格已正規化（第一根開盤 = 100）。 */
export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface DayMeta {
  symbol: string
  date: string
  scale: number
  /** 為 true 代表是開發用的合成資料，並非真實行情 */
  synthetic?: boolean
}

/** 單日檔案（對應 public/data/days/**.json） */
export interface DayFile {
  id: string
  asset: string
  interval: string
  meta: DayMeta
  /** [offsetSec, open, high, low, close, volume] */
  candles: [number, number, number, number, number, number][]
}

export interface DayIndex {
  version: number
  days: { id: string; asset: string; symbol?: string; synthetic?: boolean; file: string }[]
}

export type Side = 'buy' | 'sell'

export interface Trade {
  side: Side
  qty: number
  price: number
  fee: number
  /** 這筆成交實現的損益（不含手續費） */
  realized: number
  candleIndex: number
}

export interface GameOptions {
  initialCash?: number
  /** 單邊手續費率（成交金額比例） */
  feeRate?: number
  /** 最大槓桿（名目部位 / 淨值） */
  leverage?: number
  /** 每根 K 線拆成幾個 tick */
  ticksPerCandle?: number
  seed?: number
}

export interface Settlement {
  startEquity: number
  finalEquity: number
  pnl: number
  pnlPct: number
  trades: number
  totalFees: number
  maxDrawdownPct: number
  liquidated: boolean
}
