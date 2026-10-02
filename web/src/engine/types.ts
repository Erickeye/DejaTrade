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
export type OrderType = 'limit' | 'stop'
/** 成交原因：市價、限價成交、停損觸發、止盈、止損、強制平倉 */
export type FillReason = 'market' | 'limit' | 'stop' | 'tp' | 'sl' | 'liquidation'

/** 掛單 / 進場附帶的止盈止損設定（價格為引擎使用的正規化價格） */
export interface BracketInput {
  tp?: number | null
  sl?: number | null
  /** 追蹤停損距離（價格差，不是百分比） */
  trail?: number | null
}

export interface Order extends BracketInput {
  id: number
  type: OrderType
  side: Side
  qty: number
  price: number
}

export interface Trade {
  side: Side
  qty: number
  /** 實際成交價（含點差與滑價） */
  price: number
  fee: number
  /** 這筆成交實現的損益（不含手續費） */
  realized: number
  candleIndex: number
  reason: FillReason
}

export interface GameOptions {
  initialCash?: number
  /** 吃單（市價、停損、強平）手續費率 */
  takerFeeRate?: number
  /** 掛單（限價、止盈）手續費率 */
  makerFeeRate?: number
  /** 買賣價差（占價格比例），買單成交價 = 中間價 × (1 + 半價差) */
  spreadPct?: number
  /** 吃單額外滑價（占價格比例） */
  slippagePct?: number
  /** 維持保證金率：淨值低於 曝險 × 此值 即強平 */
  maintenanceMarginRate?: number
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
