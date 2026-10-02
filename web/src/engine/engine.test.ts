import { describe, expect, it } from 'vitest'
import { Game, OrderError, createRng, dailySeed, pickDailyDay, ticksForCandle, type Candle, type DayIndex, type GameOptions } from './index'

const mk = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t, o, h, l, c, v: 10 })
/** 每根 K 線只有一個價位（O=H=L=C），ticksPerCandle=1 時每個 step 就走到下一個價位 */
const seq = (...prices: number[]): Candle[] => prices.map((p, i) => mk(i * 60, p, p, p, p))
const flat = (n: number, p = 100): Candle[] => seq(...Array(n).fill(p))
const runAll = (g: Game) => { while (g.step()); }
/** 零成本設定：讓損益可以用整數驗算 */
const Z: GameOptions = { spreadPct: 0, slippagePct: 0, takerFeeRate: 0, makerFeeRate: 0, ticksPerCandle: 1 }
const game = (candles: Candle[], o: GameOptions = {}) => new Game(candles, { ...Z, ...o })

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
  })

  it('6 個 tick 時一定會走到真實的最高價與最低價', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const t = ticksForCandle(mk(0, 100, 105, 95, 101), 6, createRng(seed))
      expect(Math.max(...t)).toBe(105)
      expect(Math.min(...t)).toBe(95)
    }
  })
})

describe('Game 帳戶', () => {
  it('做多獲利：扣掉手續費後的損益正確', () => {
    const g = game(seq(100, 110, 110), { takerFeeRate: 0.001 })
    g.step()
    g.buy(10) // 1000 名目，手續費 1
    g.step()
    expect(g.price).toBe(110)
    expect(g.unrealized).toBeCloseTo(100)
    const s = g.settle()
    expect(s.pnl).toBeCloseTo(100 - 1 - 1.1)
    expect(g.qty).toBe(0)
  })

  it('做空獲利', () => {
    const g = game(seq(100, 90, 90))
    g.step()
    g.sell(10)
    expect(g.qty).toBe(-10)
    g.step()
    expect(g.settle().pnl).toBeCloseTo(100)
  })

  it('加碼後均價為加權平均', () => {
    const g = game(seq(100, 110, 110))
    g.step(); g.buy(10)
    g.step(); g.buy(10)
    expect(g.avgEntry).toBeCloseTo(105)
  })

  it('反手：實現原部位損益，餘量以成交價為新均價', () => {
    const g = game(seq(100, 110, 110))
    g.step(); g.buy(10)
    g.step()
    const t = g.sell(15)
    expect(t.realized).toBeCloseTo(100)
    expect(g.qty).toBe(-5)
    expect(g.avgEntry).toBe(110)
  })

  it('空倉平倉回傳 null', () => {
    expect(game(flat(2)).closeAll()).toBeNull()
  })

  it('拒絕非法數量與超過額度的下單', () => {
    const g = game(flat(3), { initialCash: 1000, leverage: 1 })
    expect(() => g.buy(0)).toThrow(OrderError)
    expect(() => g.buy(-1)).toThrow(OrderError)
    expect(() => g.buy(11)).toThrow(OrderError)
    expect(() => g.buy(9)).not.toThrow()
  })

  it('槓桿放大額度', () => {
    const g = game(flat(3), { initialCash: 1000, leverage: 5 })
    expect(() => g.buy(50)).not.toThrow()
    expect(() => g.buy(1)).toThrow(OrderError)
  })

  it('播放到最後一根後 finished，且 step 不再前進', () => {
    const g = game(flat(3), { ticksPerCandle: 2 })
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
    const g = game(seq(100, 90, 100, 100))
    g.step(); g.buy(10)
    runAll(g)
    expect(g.maxDrawdownPct).toBeCloseTo((100 / 10000) * 100, 5)
  })
})

describe('成本模型', () => {
  it('市價單：買單成交價 = 中間價 ×(1 + 半價差 + 滑價)，賣單相反', () => {
    const g = game(flat(4), { spreadPct: 0.002, slippagePct: 0.001 })
    g.step()
    expect(g.buy(1).price).toBeCloseTo(100 * (1 + 0.001 + 0.001))
    expect(g.sell(1).price).toBeCloseTo(100 * (1 - 0.001 - 0.001))
  })

  it('吃單用 taker 費率，限價成交用 maker 費率', () => {
    const g = game(seq(100, 100, 98, 98), { takerFeeRate: 0.001, makerFeeRate: 0.0002 })
    g.step()
    const m = g.buy(1)
    expect(m.fee).toBeCloseTo(100 * 0.001)
    g.placeLimit('buy', 1, 99)
    g.step(); g.step()
    const last = g.trades.at(-1)!
    expect(last.reason).toBe('limit')
    expect(last.fee).toBeCloseTo(99 * 0.0002)
  })
})

describe('限價單與停損單', () => {
  it('買進限價低於現價 → 掛單，價格跌到才以掛單價成交', () => {
    const g = game(seq(100, 99, 98, 97, 97))
    g.step()
    const o = g.placeLimit('buy', 5, 98)
    expect('id' in o).toBe(true)
    expect(g.orders).toHaveLength(1)
    g.step()
    expect(g.qty).toBe(0)
    g.step()
    expect(g.qty).toBe(5)
    expect(g.trades[0]!.price).toBe(98)
    expect(g.orders).toHaveLength(0)
  })

  it('可立即成交的限價單（買價 >= 現價）直接以市價成交', () => {
    const g = game(flat(3))
    g.step()
    const r = g.placeLimit('buy', 1, 105)
    expect('reason' in r && r.reason).toBe('market')
    expect(g.qty).toBe(1)
  })

  it('賣出限價高於現價 → 價格漲到才成交', () => {
    const g = game(seq(100, 101, 103, 103))
    g.step(); g.buy(1)
    g.placeLimit('sell', 1, 102)
    g.step(); expect(g.qty).toBe(1)
    g.step(); expect(g.qty).toBe(0)
    expect(g.trades.at(-1)!.price).toBe(102)
  })

  it('賣出停損：價格跌破觸發價後以市價成交（可能比觸發價差）', () => {
    const g = game(seq(100, 99, 95, 95))
    g.step(); g.buy(1)
    g.placeStop('sell', 1, 97)
    g.step(); expect(g.qty).toBe(1)
    g.step(); expect(g.qty).toBe(0)
    expect(g.trades.at(-1)!.reason).toBe('stop')
    expect(g.trades.at(-1)!.price).toBe(95)
  })

  it('停損單方向錯誤會被拒絕', () => {
    const g = game(flat(3))
    g.step()
    expect(() => g.placeStop('buy', 1, 99)).toThrow(OrderError)
    expect(() => g.placeStop('sell', 1, 101)).toThrow(OrderError)
  })

  it('可取消掛單；超額度的掛單被拒', () => {
    const g = game(flat(3), { initialCash: 1000 })
    g.step()
    const o = g.placeLimit('buy', 1, 90) as { id: number }
    expect(g.cancelOrder(o.id)).toBe(true)
    expect(g.orders).toHaveLength(0)
    expect(() => g.placeLimit('buy', 100, 90)).toThrow(OrderError)
  })

  it('結算會取消所有掛單', () => {
    const g = game(flat(3))
    g.step()
    g.placeLimit('buy', 1, 90)
    g.settle()
    expect(g.orders).toHaveLength(0)
  })
})

describe('止盈止損與追蹤停損', () => {
  it('市價單附帶止損：跌破後自動平倉', () => {
    const g = game(seq(100, 99, 94, 94))
    g.step()
    g.buy(1, { sl: 95 })
    expect(g.sl).toBe(95)
    g.step(); expect(g.qty).toBe(1)
    g.step(); expect(g.qty).toBe(0)
    const t = g.trades.at(-1)!
    expect(t.reason).toBe('sl')
    expect(t.price).toBe(94)
    expect(g.sl).toBeNull()
  })

  it('止盈以止盈價成交（maker 費率）', () => {
    const g = game(seq(100, 103, 106, 106), { makerFeeRate: 0.0002 })
    g.step()
    g.buy(1, { tp: 105 })
    g.step(); expect(g.qty).toBe(1)
    g.step()
    expect(g.qty).toBe(0)
    const t = g.trades.at(-1)!
    expect(t.reason).toBe('tp')
    expect(t.price).toBe(105)
    expect(t.fee).toBeCloseTo(105 * 0.0002)
  })

  it('空單的止盈止損方向相反', () => {
    const g = game(seq(100, 101, 106, 106))
    g.step()
    g.sell(1, { sl: 105, tp: 90 })
    g.step(); expect(g.qty).toBe(-1)
    g.step(); expect(g.qty).toBe(0)
    expect(g.trades.at(-1)!.reason).toBe('sl')
  })

  it('同一個 tick 同時碰到止盈止損時，止損優先', () => {
    const g = game(seq(100, 100, 100))
    g.step()
    g.buy(1, { sl: 95, tp: 105 })
    g.sl = 101 // 人為製造兩者同時滿足
    g.tp = 99
    g.step()
    expect(g.trades.at(-1)!.reason).toBe('sl')
  })

  it('價格方向錯誤的止盈止損被拒絕', () => {
    const g = game(flat(3))
    g.step()
    expect(() => g.buy(1, { sl: 101 })).toThrow(OrderError)
    expect(() => g.buy(1, { tp: 99 })).toThrow(OrderError)
    expect(() => g.sell(1, { sl: 99 })).toThrow(OrderError)
    expect(g.qty).toBe(0) // 被拒絕時不會成交
  })

  it('setBracket 可修改與清除持倉的止盈止損', () => {
    const g = game(flat(4))
    g.step()
    expect(() => g.setBracket({ sl: 90 })).toThrow(OrderError) // 沒有持倉
    g.buy(1)
    g.setBracket({ sl: 95, tp: 110 })
    expect([g.sl, g.tp]).toEqual([95, 110])
    g.setBracket({ tp: null })
    expect([g.sl, g.tp]).toEqual([95, null])
  })

  it('平倉或反手後，舊的止盈止損作廢', () => {
    const g = game(flat(4))
    g.step()
    g.buy(1, { sl: 95, tp: 110 })
    g.sell(2)
    expect(g.qty).toBe(-1)
    expect([g.sl, g.tp]).toEqual([null, null])
  })

  it('追蹤停損：止損價跟著新高上移，回檔超過距離才出場', () => {
    const g = game(seq(100, 104, 110, 107, 105, 105))
    g.step()
    g.buy(1, { trail: 5 })
    expect(g.sl).toBe(95)
    g.step(); expect(g.sl).toBe(99) // 104 - 5
    g.step(); expect(g.sl).toBe(105) // 110 - 5
    g.step(); expect(g.qty).toBe(1) // 107 > 105，仍持有；止損不下移
    expect(g.sl).toBe(105)
    g.step()
    expect(g.qty).toBe(0) // 105 <= 105
    expect(g.trades.at(-1)!.reason).toBe('sl')
  })

  it('部分平倉', () => {
    const g = game(flat(3))
    g.step(); g.buy(10)
    g.closeFraction(0.25)
    expect(g.qty).toBeCloseTo(7.5)
    g.closeFraction(1)
    expect(g.qty).toBe(0)
  })

  it('掛單成交後附帶的止損會生效', () => {
    const g = game(seq(100, 98, 98, 93, 93))
    g.step()
    g.placeLimit('buy', 1, 98, { sl: 95 })
    g.step()
    expect(g.qty).toBe(1)
    expect(g.sl).toBe(95)
    g.step(); g.step()
    expect(g.qty).toBe(0)
  })
})

describe('槓桿、強平與強平價', () => {
  it('高槓桿下價格不利變動會爆倉並強制平倉', () => {
    const g = game(seq(100, 70, 70), { initialCash: 1000, leverage: 10 })
    g.step()
    g.buy(100) // 10000 名目
    g.step()
    expect(g.liquidated).toBe(true)
    expect(g.qty).toBe(0)
    expect(g.finished).toBe(true)
    expect(g.cash).toBeGreaterThanOrEqual(0) // 虧損最多是整個帳戶
    expect(() => g.buy(1)).toThrow(OrderError)
    expect(g.trades.at(-1)!.reason).toBe('liquidation')
  })

  it('多單強平價公式：在強平價之上不爆，跌到強平價才爆', () => {
    const g = game(seq(100, 100, 91, 90), { initialCash: 1000, leverage: 10, maintenanceMarginRate: 0.005 })
    g.step()
    g.buy(100)
    const lp = g.liquidationPrice!
    expect(lp).toBeCloseTo(9000 / (100 * 0.995), 6) // ≈ 90.45
    g.step(); g.step()
    expect(g.liquidated).toBe(false) // 91 > 90.45
    g.step()
    expect(g.liquidated).toBe(true) // 90 < 90.45
  })

  it('空單強平價在現價之上；1x 做多沒有強平價', () => {
    const g = game(flat(3), { initialCash: 1000, leverage: 10 })
    g.step()
    g.sell(100)
    expect(g.liquidationPrice!).toBeGreaterThan(100)
    const h = game(flat(3), { initialCash: 1000, leverage: 1 })
    h.step(); h.buy(5)
    expect(h.liquidationPrice).toBeNull()
    expect(game(flat(2)).liquidationPrice).toBeNull()
  })
})

describe('每日挑戰', () => {
  const index: DayIndex = { version: 1, days: Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, asset: 'crypto', file: `d${i}.json` })) }
  it('同一天抽到同一局，種子取決於日期', () => {
    expect(pickDailyDay(index, '2026-10-02').id).toBe(pickDailyDay(index, '2026-10-02').id)
    expect(dailySeed('2026-10-02')).not.toBe(dailySeed('2026-10-03'))
  })
})
