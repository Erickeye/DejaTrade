/** 技術指標（SMA / EMA / VWAP / 布林通道 / RSI / MACD），支援逐根收盤更新與「不改變狀態」的即時試算。 */

export interface Bar {
  /** 距離該局開始的秒數（週期聚合後為該根 K 線的起點） */
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface IndicatorValues {
  sma?: number
  ema?: number
  vwap?: number
  bbMid?: number
  bbUpper?: number
  bbLower?: number
  rsi?: number
  macd?: number
  macdSignal?: number
  macdHist?: number
}

export interface IndicatorConfig {
  smaPeriod: number
  emaPeriod: number
  bbPeriod: number
  bbMult: number
  rsiPeriod: number
  macdFast: number
  macdSlow: number
  macdSignal: number
}

export const DEFAULT_INDICATORS: IndicatorConfig = {
  smaPeriod: 20, emaPeriod: 20, bbPeriod: 20, bbMult: 2, rsiPeriod: 14, macdFast: 12, macdSlow: 26, macdSignal: 9,
}

interface EmaState { n: number; sum: number; value?: number }
interface RsiState { prev?: number; n: number; sumG: number; sumL: number; avgG?: number; avgL?: number }
interface State {
  closes: number[] // 只保留最近 max(period) - 1 根
  ema: EmaState
  fast: EmaState
  slow: EmaState
  signal: EmaState
  rsi: RsiState
  pv: number
  vol: number
}

/** EMA 以前 period 根的 SMA 作為起點（與多數看盤軟體一致） */
function emaNext(s: EmaState, x: number, period: number): EmaState {
  if (s.value === undefined) {
    const n = s.n + 1
    const sum = s.sum + x
    return n >= period ? { n, sum, value: sum / period } : { n, sum }
  }
  const k = 2 / (period + 1)
  return { n: s.n + 1, sum: s.sum, value: s.value + k * (x - s.value) }
}

function rsiNext(s: RsiState, c: number, period: number): RsiState {
  if (s.prev === undefined) return { ...s, prev: c }
  const d = c - s.prev
  const g = Math.max(d, 0), l = Math.max(-d, 0)
  if (s.avgG === undefined) {
    const n = s.n + 1, sumG = s.sumG + g, sumL = s.sumL + l
    return n >= period ? { prev: c, n, sumG, sumL, avgG: sumG / period, avgL: sumL / period } : { prev: c, n, sumG, sumL }
  }
  return { ...s, prev: c, n: s.n + 1, avgG: (s.avgG * (period - 1) + g) / period, avgL: (s.avgL! * (period - 1) + l) / period }
}

const emptyState = (): State => ({
  closes: [],
  ema: { n: 0, sum: 0 }, fast: { n: 0, sum: 0 }, slow: { n: 0, sum: 0 }, signal: { n: 0, sum: 0 },
  rsi: { n: 0, sumG: 0, sumL: 0 },
  pv: 0, vol: 0,
})

export class Indicators {
  private state = emptyState()
  constructor(readonly cfg: IndicatorConfig = DEFAULT_INDICATORS) {}

  /** 一根 K 線收盤：更新內部狀態並回傳這根的指標值 */
  pushClosed(bar: Bar): IndicatorValues {
    const [s, v] = this.calc(this.state, bar)
    this.state = s
    return v
  }

  /** 進行中的 K 線：只試算，不改變狀態 */
  peek(bar: Bar): IndicatorValues {
    return this.calc(this.state, bar)[1]
  }

  reset() {
    this.state = emptyState()
  }

  private calc(st: State, bar: Bar): [State, IndicatorValues] {
    const { cfg } = this
    const c = bar.c
    const v: IndicatorValues = {}

    const keep = Math.max(cfg.smaPeriod, cfg.bbPeriod)
    const window = [...st.closes, c]
    if (window.length >= cfg.smaPeriod) v.sma = mean(window.slice(-cfg.smaPeriod))
    if (window.length >= cfg.bbPeriod) {
      const w = window.slice(-cfg.bbPeriod)
      const m = mean(w)
      const sd = Math.sqrt(mean(w.map((x) => (x - m) ** 2)))
      v.bbMid = m
      v.bbUpper = m + cfg.bbMult * sd
      v.bbLower = m - cfg.bbMult * sd
    }

    const ema = emaNext(st.ema, c, cfg.emaPeriod)
    v.ema = ema.value
    const fast = emaNext(st.fast, c, cfg.macdFast)
    const slow = emaNext(st.slow, c, cfg.macdSlow)
    let signal = st.signal
    if (fast.value !== undefined && slow.value !== undefined) {
      const macd = fast.value - slow.value
      signal = emaNext(st.signal, macd, cfg.macdSignal)
      v.macd = macd
      if (signal.value !== undefined) {
        v.macdSignal = signal.value
        v.macdHist = macd - signal.value
      }
    }

    const rsi = rsiNext(st.rsi, c, cfg.rsiPeriod)
    if (rsi.avgG !== undefined) v.rsi = rsi.avgL === 0 ? 100 : 100 - 100 / (1 + rsi.avgG / rsi.avgL!)

    const typical = (bar.h + bar.l + bar.c) / 3
    const pv = st.pv + typical * bar.v
    const vol = st.vol + bar.v
    if (vol > 0) v.vwap = pv / vol

    return [{ closes: window.slice(-(keep - 1)), ema, fast, slow, signal, rsi, pv, vol }, v]
  }
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
