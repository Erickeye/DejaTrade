import type { Candle } from './types'
import type { Rng } from './rng'

/**
 * 把一根 OHLC K 線拆成 n 個 tick 價格：O → (H/L) → (L/H) → C。
 * 先高後低或先低後高由 rng 決定；所有價格保證落在 [low, high]；最後一個 tick = close。
 */
export function ticksForCandle(c: Candle, n: number, rng: Rng): number[] {
  if (n <= 1) return [c.c]
  const highFirst = rng() < 0.5
  const waypoints = highFirst ? [c.o, c.h, c.l, c.c] : [c.o, c.l, c.h, c.c]
  const out: number[] = []
  const segs = waypoints.length - 1
  for (let i = 1; i <= n; i++) {
    const pos = (i / n) * segs
    const seg = Math.min(Math.floor(pos), segs - 1)
    const f = pos - seg
    const a = waypoints[seg]!
    const b = waypoints[seg + 1]!
    // 加一點小雜訊讓跳動不呆板，但不超出影線範圍
    // 轉折點（H / L）與收盤不加雜訊，確保真實高低點會被走到
    const onWaypoint = Math.abs(pos - Math.round(pos)) < 1e-9
    const noise = onWaypoint ? 0 : (rng() - 0.5) * (c.h - c.l) * 0.1
    const p = a + (b - a) * f + noise
    out.push(Math.min(c.h, Math.max(c.l, p)))
  }
  out[n - 1] = c.c
  return out
}
