export interface IndicatorToggles {
  sma: boolean
  ema: boolean
  vwap: boolean
  bb: boolean
  rsi: boolean
  macd: boolean
}

export const DEFAULT_TOGGLES: IndicatorToggles = { sma: false, ema: false, vwap: false, bb: false, rsi: false, macd: false }

export const INDICATOR_LABELS: Record<keyof IndicatorToggles, string> = {
  sma: 'SMA 20', ema: 'EMA 20', vwap: 'VWAP', bb: '布林通道', rsi: 'RSI 14', macd: 'MACD',
}

export interface ChartDisplay {
  /** 正規化價格 → 真實價格的倍率 */
  k: number
  /** 當日 UTC 0 點（秒），盲測模式為 0 */
  base: number
}
