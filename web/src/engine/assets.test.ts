import { describe, expect, it } from 'vitest'
import { Game, gameOptionsForDay, lotNotionalUsd, lotsFromQty, symbolLabel, type Candle, type DayMeta } from './index'

const EUR: DayMeta = { symbol: 'EURUSD', date: '2025-03-04', scale: 1.08, pipSize: 0.0001, digits: 5, spreadPips: 0.5, usdIsQuote: true }
const JPY: DayMeta = { symbol: 'USDJPY', date: '2025-03-04', scale: 150, pipSize: 0.01, digits: 3, spreadPips: 0.6, usdIsQuote: false }
const flat = (n: number): Candle[] => Array.from({ length: n }, (_, i) => ({ t: i * 60, o: 100, h: 100, l: 100, c: 100, v: 1 }))

describe('外匯資產設定', () => {
  it('加密貨幣沿用預設成本模型', () => {
    expect(gameOptionsForDay('crypto', { symbol: 'BTCUSDT', date: '', scale: 1 }, 5, 7)).toEqual({ seed: 7, leverage: 5 })
  })

  it('外匯：無手續費，買入成交價比中間價高「半個點差 + 滑價」（以 pip 計）', () => {
    const g = new Game(flat(3), { ...gameOptionsForDay('fx', EUR, 30, 1), ticksPerCandle: 1 })
    g.step()
    const t = g.buy(10)
    const pips = ((t.price - g.price) / g.price) * EUR.scale / EUR.pipSize!
    expect(pips).toBeCloseTo(0.5 / 2 + 0.1, 6)
    expect(t.fee).toBe(0)
  })

  it('日圓對的 pip 換算：點差 0.6 pip = 0.006 日圓', () => {
    const o = gameOptionsForDay('fx', JPY, 30, 1)
    expect(o.spreadPct! * JPY.scale).toBeCloseTo(0.6 * 0.01)
  })

  it('外匯的強制平倉門檻 = 已占用保證金的 50%', () => {
    expect(gameOptionsForDay('fx', EUR, 100, 1).maintenanceMarginRate).toBeCloseTo(0.005)
    expect(gameOptionsForDay('fx', EUR, 10, 1).maintenanceMarginRate).toBeCloseTo(0.05)
  })

  it('手數換算：EURUSD 1 手 ≈ 價格 × 100,000 美元；USDJPY 1 手 = 100,000 美元', () => {
    expect(lotNotionalUsd(EUR, 1.08)).toBeCloseTo(108_000)
    expect(lotNotionalUsd(JPY, 150)).toBe(100_000)
  })

  it('部位數量換算手數：下 1 手 EURUSD，再換回來仍是 1 手', () => {
    const k = EUR.scale / 100
    const normPrice = 100
    const qty = (1 * lotNotionalUsd(EUR, normPrice * k)) / normPrice
    expect(lotsFromQty(EUR, qty, normPrice, k)).toBeCloseTo(1)
    const kj = JPY.scale / 100
    const qj = (0.5 * lotNotionalUsd(JPY, normPrice * kj)) / normPrice
    expect(lotsFromQty(JPY, qj, normPrice, kj)).toBeCloseTo(0.5)
  })

  it('商品名稱顯示', () => {
    expect(symbolLabel('EURUSD', 'fx')).toBe('EUR/USD')
    expect(symbolLabel('BTCUSDT', 'crypto')).toBe('BTC')
  })
})
