import { describe, expect, it } from 'vitest'
import { roundTrips, tradeStats } from './stats'
import type { Trade } from './types'

const t = (side: 'buy' | 'sell', qty: number, price: number, candleIndex: number, realized = 0, fee = 0, reason: Trade['reason'] = 'market'): Trade => ({ side, qty, price, fee, realized, candleIndex, reason })

describe('roundTrips', () => {
  it('一買一賣 = 一筆來回，損益扣手續費', () => {
    const r = roundTrips([t('buy', 2, 100, 3, 0, 0.1), t('sell', 2, 110, 10, 20, 0.2, 'tp')])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ side: 'long', entryCandle: 3, exitCandle: 10, qty: 2, entryPrice: 100, exitPrice: 110, exitReason: 'tp' })
    expect(r[0]!.pnl).toBeCloseTo(20 - 0.3)
  })

  it('加碼後分批平倉：到歸零才算一筆', () => {
    const r = roundTrips([
      t('buy', 1, 100, 1), t('buy', 1, 102, 2),
      t('sell', 1, 105, 5, 4), t('sell', 1, 99, 6, -2, 0, 'sl'),
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ qty: 2, entryPrice: 101, exitPrice: 102 })
    expect(r[0]!.pnl).toBeCloseTo(2)
  })

  it('反手會拆成兩筆來回，手續費與損益依數量分攤', () => {
    // 多 1 @100，賣 3 @110：平多 1（+10），反手空 2
    const r = roundTrips([t('buy', 1, 100, 0), t('sell', 3, 110, 4, 10, 0.3), t('buy', 2, 105, 8, 10, 0.2)])
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ side: 'long', pnl: 10 - 0.1 })
    expect(r[1]).toMatchObject({ side: 'short', qty: 2, entryPrice: 110, exitPrice: 105 })
    expect(r[1]!.pnl).toBeCloseTo(10 - 0.2 - 0.2)
  })

  it('尚未平倉的部位不列入', () => {
    expect(roundTrips([t('buy', 1, 100, 0)])).toHaveLength(0)
  })
})

describe('tradeStats', () => {
  it('勝率 / 盈虧比 / 獲利因子', () => {
    const trips = roundTrips([
      t('buy', 1, 100, 0), t('sell', 1, 110, 2, 10),
      t('buy', 1, 100, 3), t('sell', 1, 95, 5, -5),
      t('buy', 1, 100, 6), t('sell', 1, 106, 10, 6),
    ])
    const s = tradeStats(trips)
    expect(s).toMatchObject({ count: 3, wins: 2, losses: 1, best: 10, worst: -5 })
    expect(s.winRate).toBeCloseTo(2 / 3)
    expect(s.payoff).toBeCloseTo(8 / 5)
    expect(s.profitFactor).toBeCloseTo(16 / 5)
    expect(s.avgHold).toBeCloseTo((2 + 2 + 4) / 3)
  })

  it('沒有交易或沒有虧損時不除以零', () => {
    expect(tradeStats([]).winRate).toBeNull()
    const s = tradeStats(roundTrips([t('buy', 1, 100, 0), t('sell', 1, 101, 1, 1)]))
    expect(s.payoff).toBeNull()
    expect(s.profitFactor).toBeNull()
  })
})
