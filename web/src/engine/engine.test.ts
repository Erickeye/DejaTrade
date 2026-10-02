import { describe, expect, it } from 'vitest'
import { Game, OrderError, createRng, dailySeed, pickDailyDay, ticksForCandle, type Candle, type DayIndex } from './index'

const mk = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t, o, h, l, c, v: 10 })
const flat = (n: number, p = 100): Candle[] => Array.from({ length: n }, (_, i) => mk(i * 60, p, p, p, p))
const runAll = (g: Game) => { while (g.step()); }

describe('rng', () => {
  it('同種子產生相同序列', () => {
    const a = createRng(42), b = createRng(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
})

describe('ticksForCandle', () => {
  it('落在影線範圍內、最後一個 tick = close、同種子可重現', () => {
    const c = mk(0, 100, 105, 95, 101)
    const t1 = ticksForCandle(c, 8, createRng(7))
    const t2 = ticksForCandle(c, 8, createRng(7))
    expect(t1).toEqual(t2)
    expect(t1).toHaveLength(8)
    expect(t1.every((p) => p >= 95 && p <= 105)).toBe(true)
    expect(t1.at(-1)).toBe(101)
    expect(Math.max(...t1)).toBeGreaterThan(100)
  })
})

describe('Game 帳戶', () => {
  it('做多獲利：扣掉手續費後的損益正確', () => {
    const g = new Game([mk(0, 100, 100, 100, 100), mk(60, 100, 110, 100, 110)], { feeRate: 0.001, ticksPerCandle: 1 })
    g.buy(10) // 1000 名目，手續費 1
    g.step(); g.step()
    expect(g.price).toBe(110)
    expect(g.unrealized).toBeCloseTo(100)
    const s = g.settle()
    // 買 10@100、賣 10@110：毛利 100，手續費 1 + 1.1
    expect(s.pnl).toBeCloseTo(100 - 1 - 1.1)
    expect(g.qty).toBe(0)
  })

  it('做空獲利', () => {
    const g = new Game([mk(0, 100, 100, 100, 100), mk(60, 100, 100, 90, 90)], { feeRate: 0, ticksPerCandle: 1 })
    g.sell(10)
    expect(g.qty).toBe(-10)
    runAll(g)
    expect(g.settle().pnl).toBeCloseTo(100)
  })

  it('加碼後均價為加權平均', () => {
    const g = new Game([mk(0, 100, 100, 100, 100), mk(60, 110, 110, 110, 110), mk(120, 110, 110, 110, 110)], { feeRate: 0, ticksPerCandle: 1 })
    g.buy(10)
    g.step(); g.step()
    g.buy(10)
    expect(g.avgEntry).toBeCloseTo(105)
  })

  it('反手：實現原部位損益，餘量以成交價為新均價', () => {
    const g = new Game([mk(0, 100, 100, 100, 100), mk(60, 110, 110, 110, 110), mk(120, 110, 110, 110, 110)], { feeRate: 0, ticksPerCandle: 1 })
    g.buy(10)
    g.step(); g.step()
    const t = g.sell(15)
    expect(t.realized).toBeCloseTo(100)
    expect(g.qty).toBe(-5)
    expect(g.avgEntry).toBe(110)
  })

  it('空倉平倉回傳 null', () => {
    const g = new Game(flat(2))
    expect(g.closeAll()).toBeNull()
  })

  it('拒絕非法數量與超過額度的下單', () => {
    const g = new Game(flat(2), { initialCash: 1000, leverage: 1 })
    expect(() => g.buy(0)).toThrow(OrderError)
    expect(() => g.buy(-1)).toThrow(OrderError)
    expect(() => g.buy(11)).toThrow(OrderError) // 1100 > 1000
    expect(() => g.buy(9)).not.toThrow()
  })

  it('槓桿放大額度', () => {
    const g = new Game(flat(2), { initialCash: 1000, leverage: 5, feeRate: 0 })
    expect(() => g.buy(50)).not.toThrow()
    expect(() => g.buy(1)).toThrow(OrderError)
  })

  it('高槓桿下價格不利變動會爆倉並強制平倉', () => {
    const g = new Game([mk(0, 100, 100, 100, 100), mk(60, 100, 100, 70, 70)], { initialCash: 1000, leverage: 10, feeRate: 0, ticksPerCandle: 1 })
    g.buy(100) // 10000 名目
    runAll(g)
    expect(g.liquidated).toBe(true)
    expect(g.qty).toBe(0)
    expect(g.finished).toBe(true)
    expect(() => g.buy(1)).toThrow(OrderError)
  })

  it('播放到最後一根後 finished，且 step 不再前進', () => {
    const g = new Game(flat(3), { ticksPerCandle: 2 })
    runAll(g)
    expect(g.finished).toBe(true)
    expect(g.step()).toBe(false)
    expect(g.candleIndex).toBe(2)
  })

  it('同種子同操作結果完全一致', () => {
    const candles = Array.from({ length: 30 }, (_, i) => mk(i * 60, 100 + i, 102 + i, 98 + i, 101 + i))
    const run = () => { const g = new Game(candles, { seed: 9 }); const seen: number[] = []; while (g.step()) seen.push(g.price); return seen }
    expect(run()).toEqual(run())
  })

  it('最大回撤有被記錄', () => {
    const g = new Game([mk(0, 100, 100, 100, 100), mk(60, 100, 100, 90, 90), mk(120, 90, 100, 90, 100)], { feeRate: 0, ticksPerCandle: 1 })
    g.buy(10)
    runAll(g)
    expect(g.maxDrawdownPct).toBeCloseTo((100 / (10000 + 0)) * 100, 5)
  })
})

describe('每日挑戰', () => {
  const index: DayIndex = { version: 1, days: Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, asset: 'crypto', file: `d${i}.json` })) }
  it('同一天抽到同一局，種子取決於日期', () => {
    expect(pickDailyDay(index, '2026-10-02').id).toBe(pickDailyDay(index, '2026-10-02').id)
    expect(dailySeed('2026-10-02')).not.toBe(dailySeed('2026-10-03'))
  })
})
