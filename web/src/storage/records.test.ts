import { describe, expect, it } from 'vitest'
import { bestStreak, dailyRecord, dailyStreak, memoryStore, summarize, type GameRecord } from './records'

const rec = (o: Partial<GameRecord> = {}): GameRecord => ({
  id: String(Math.random()), ts: 1, daily: false, blind: false, asset: 'crypto', symbol: 'BTCUSDT', date: '2025-01-01',
  synthetic: false, leverage: 1, pnl: 0, pnlPct: 0, trades: 0, winRate: null, maxDrawdownPct: 0, liquidated: false, ...o,
})

describe('每日連勝', () => {
  it('今天或昨天有玩才算連勝中', () => {
    expect(dailyStreak(['2026-10-05', '2026-10-06', '2026-10-07'], '2026-10-07')).toBe(3)
    expect(dailyStreak(['2026-10-05', '2026-10-06'], '2026-10-07')).toBe(2) // 今天還沒玩，不中斷
    expect(dailyStreak(['2026-10-04', '2026-10-05'], '2026-10-07')).toBe(0) // 昨天沒玩 → 中斷
    expect(dailyStreak([], '2026-10-07')).toBe(0)
  })
  it('月底跨月與重複日期', () => {
    expect(dailyStreak(['2026-09-30', '2026-10-01', '2026-10-01'], '2026-10-01')).toBe(2)
  })
  it('歷史最長連勝', () => {
    expect(bestStreak(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-10', '2026-01-11'])).toBe(3)
    expect(bestStreak([])).toBe(0)
  })
})

describe('summarize', () => {
  it('統計局數、勝率、最佳最差', () => {
    const rs = [rec({ pnl: 100, pnlPct: 1 }), rec({ pnl: -300, pnlPct: -3, liquidated: true }), rec({ pnl: 50, pnlPct: 0.5 })]
    const s = summarize(rs, '2026-10-07')
    expect(s).toMatchObject({ games: 3, winGames: 2, totalPnl: -150, liquidations: 1 })
    expect(s.winRate).toBeCloseTo(2 / 3)
    expect(s.best?.pnlPct).toBe(1)
    expect(s.worst?.pnlPct).toBe(-3)
  })
  it('沒有紀錄', () => {
    const s = summarize([], '2026-10-07')
    expect(s).toMatchObject({ games: 0, winRate: null, best: null, worst: null, dailyStreak: 0 })
  })
})

describe('dailyRecord / memoryStore', () => {
  it('每日挑戰只算當天第一次', () => {
    const a = rec({ daily: true, dailyDate: '2026-10-07', ts: 5, pnl: 10 }), b = rec({ daily: true, dailyDate: '2026-10-07', ts: 9, pnl: 99 })
    expect(dailyRecord([b, a], '2026-10-07')?.pnl).toBe(10)
    expect(dailyRecord([a], '2026-10-08')).toBeUndefined()
  })
  it('memoryStore 增、清', async () => {
    const s = memoryStore()
    await s.add(rec()); await s.add(rec())
    expect(await s.all()).toHaveLength(2)
    await s.clear()
    expect(await s.all()).toHaveLength(0)
  })
})
