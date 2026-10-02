export * from './types'
export * from './rng'
export * from './ticks'
export * from './pick'
export * from './game'

import type { Candle, DayFile } from './types'

export function toCandles(day: DayFile): Candle[] {
  return day.candles.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
}
