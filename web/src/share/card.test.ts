import { describe, expect, it } from 'vitest'
import { buildShareData, type ShareInput } from './card'

const base: ShareInput = {
  daily: false, blind: false, label: 'BTC · 2025-03-12', dailyDate: '2026-10-12', leverage: 5, pnl: 120, pnlPct: 1.2,
  equity: [10000, 10120], winRate: 0.5, trades: 4, maxDrawdownPct: 0.8, payoff: 1.5, liquidated: false, synthetic: false, siteUrl: 'example.com/DejaTrade',
}

describe('buildShareData（劇透保護）', () => {
  it('實況局顯示標的與日期', () => {
    expect(buildShareData(base).subtitle).toBe('BTC · 2025-03-12')
  })
  it('盲測局與每日挑戰不洩漏標的與日期', () => {
    expect(buildShareData({ ...base, blind: true }).subtitle).toBe('盲測局')
    const d = buildShareData({ ...base, daily: true })
    expect(d.subtitle).toBe('今日挑戰 · 2026-10-12')
    expect(d.subtitle).not.toContain('BTC')
  })
  it('標籤：槓桿、爆倉、合成資料', () => {
    expect(buildShareData({ ...base, liquidated: true, synthetic: true }).tags).toEqual(['槓桿 5x', '爆倉', '合成資料'])
  })
  it('沒有交易時統計顯示破折號', () => {
    const d = buildShareData({ ...base, winRate: null, payoff: null, trades: 0 })
    expect(d.rows).toContainEqual(['勝率', '—'])
    expect(d.rows).toContainEqual(['盈虧比', '—'])
  })
})
