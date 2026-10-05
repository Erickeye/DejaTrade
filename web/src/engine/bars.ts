import type { Bar } from './indicators'
import type { Candle } from './types'

export const TIMEFRAMES = [1, 5, 15, 60] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

const fromCandle = (c: Candle, t: number): Bar => ({ t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })
const merge = (b: Bar, c: Candle): Bar => ({ t: b.t, o: b.o, h: Math.max(b.h, c.h), l: Math.min(b.l, c.l), c: c.c, v: b.v + c.v })

/**
 * 把 1 分鐘 K 線聚合成較大週期（5m / 15m / 1h）。
 * update() 每次傳入「已完成的 1 分鐘 K 線數量」與「進行中的那根」，回傳新收盤的聚合 K 線與目前進行中的聚合 K 線。
 */
export class BarBuilder {
  private consumed = 0
  private open: Bar | null = null
  readonly tfSec: number

  constructor(readonly tfMinutes: number) {
    this.tfSec = tfMinutes * 60
  }

  private bucket(t: number) {
    return Math.floor(t / this.tfSec) * this.tfSec
  }

  update(candles: Candle[], completedCount: number, live: Candle): { closed: Bar[]; live: Bar } {
    const closed: Bar[] = []
    for (; this.consumed < completedCount; this.consumed++) {
      const c = candles[this.consumed]!
      const b = this.bucket(c.t)
      if (this.open && this.open.t !== b) {
        closed.push(this.open)
        this.open = null
      }
      this.open = this.open ? merge(this.open, c) : fromCandle(c, b)
    }
    const lb = this.bucket(live.t)
    if (this.open && this.open.t !== lb) {
      closed.push(this.open)
      this.open = null
    }
    return { closed, live: this.open ? merge(this.open, live) : fromCandle(live, lb) }
  }
}
