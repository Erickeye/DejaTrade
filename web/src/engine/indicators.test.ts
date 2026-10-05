import { describe, expect, it } from 'vitest'
import { BarBuilder, Indicators, type Bar, type Candle } from './index'

const bar = (c: number, v = 1, t = 0): Bar => ({ t, o: c, h: c, l: c, c, v })
const feed = (ind: Indicators, closes: number[]) => closes.map((c) => ind.pushClosed(bar(c)))

describe('Indicators', () => {
  it('SMA：不足週期為 undefined，之後為最近 N 根平均', () => {
    const r = feed(new Indicators(), Array.from({ length: 25 }, (_, i) => i + 1))
    expect(r[18]!.sma).toBeUndefined()
    expect(r[19]!.sma).toBeCloseTo(10.5) // 1..20
    expect(r[24]!.sma).toBeCloseTo(15.5) // 6..25
  })

  it('EMA：以前 N 根 SMA 為起點，之後套用遞迴公式', () => {
    const r = feed(new Indicators(), Array.from({ length: 21 }, (_, i) => i + 1))
    expect(r[19]!.ema).toBeCloseTo(10.5)
    expect(r[20]!.ema).toBeCloseTo(10.5 + (2 / 21) * (21 - 10.5))
  })

  it('布林通道：常數序列的上下軌等於中軌；波動時上軌 > 中軌 > 下軌', () => {
    const flat = feed(new Indicators(), Array(20).fill(50))[19]!
    expect(flat.bbUpper).toBeCloseTo(50)
    const wavy = feed(new Indicators(), Array.from({ length: 20 }, (_, i) => 50 + (i % 2 ? 1 : -1)))[19]!
    expect(wavy.bbUpper!).toBeGreaterThan(wavy.bbMid!)
    expect(wavy.bbLower!).toBeLessThan(wavy.bbMid!)
    expect(wavy.bbUpper! - wavy.bbMid!).toBeCloseTo(2) // 標準差 1 × 2
  })

  it('RSI：一路上漲 = 100，一路下跌 = 0，之後會回落', () => {
    const up = feed(new Indicators(), Array.from({ length: 20 }, (_, i) => 100 + i))
    expect(up[13]!.rsi).toBeUndefined() // 需要 14 個變動 = 15 根
    expect(up[14]!.rsi).toBe(100)
    const down = feed(new Indicators(), Array.from({ length: 20 }, (_, i) => 100 - i))
    expect(down[19]!.rsi).toBeCloseTo(0)
    const mix = feed(new Indicators(), [...Array.from({ length: 16 }, (_, i) => 100 + i), 90])
    expect(mix.at(-1)!.rsi!).toBeLessThan(100)
  })

  it('MACD：第 26 根起有 macd 線，第 34 根起有 signal 與 histogram', () => {
    const r = feed(new Indicators(), Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.2))
    expect(r[24]!.macd).toBeUndefined()
    expect(r[25]!.macd).toBeDefined()
    expect(r[32]!.macdSignal).toBeUndefined()
    expect(r[33]!.macdSignal).toBeDefined()
    expect(r[39]!.macdHist).toBeCloseTo(r[39]!.macd! - r[39]!.macdSignal!)
  })

  it('VWAP：以成交量加權', () => {
    const ind = new Indicators()
    ind.pushClosed(bar(100, 1))
    const v = ind.pushClosed(bar(110, 3))
    expect(v.vwap).toBeCloseTo((100 * 1 + 110 * 3) / 4)
  })

  it('peek 不改變狀態：先 peek 再 pushClosed 的結果與直接 pushClosed 相同', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 8)
    const a = new Indicators(), b = new Indicators()
    for (const c of closes) {
      a.peek(bar(c + 1)) // 進行中的試算
      a.peek(bar(c + 2))
      expect(a.pushClosed(bar(c))).toEqual(b.pushClosed(bar(c)))
    }
  })
})

describe('BarBuilder 週期聚合', () => {
  const candles: Candle[] = Array.from({ length: 12 }, (_, i) => ({ t: i * 60, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i + 0.5, v: 2 }))

  it('5 分鐘：每 5 根 1 分鐘合成 1 根，OHLCV 正確', () => {
    const b = new BarBuilder(5)
    const closed = []
    // 模擬逐根播放：第 n 步時已完成 n 根，進行中為 candles[n]
    for (let n = 0; n < candles.length; n++) closed.push(...b.update(candles, n, candles[n]!).closed)
    expect(closed).toHaveLength(2) // 第 0~4、5~9 根已收盤
    expect(closed[0]).toEqual({ t: 0, o: 100, h: 105, l: 99, c: 104.5, v: 10 })
    expect(closed[1]!.t).toBe(300)
  })

  it('進行中的聚合 K 線包含已完成的分鐘與目前進行中的那根', () => {
    const b = new BarBuilder(5)
    let live = b.update(candles, 0, candles[0]!).live
    for (let n = 1; n <= 7; n++) live = b.update(candles, n, candles[n]!).live
    // n=7：bucket 300 內已完成第 5、6 根，進行中第 7 根
    expect(live.t).toBe(300)
    expect(live.o).toBe(105)
    expect(live.c).toBe(107.5)
    expect(live.v).toBe(6)
  })

  it('1 分鐘週期等於原始 K 線', () => {
    const b = new BarBuilder(1)
    const r = b.update(candles, 3, candles[3]!)
    expect(r.closed).toHaveLength(3)
    expect(r.live).toMatchObject({ t: 180, o: 103, c: 103.5 })
  })
})
