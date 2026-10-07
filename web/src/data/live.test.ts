import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildLiveDay, fetchLiveDay, liveDateFor, pickLiveDay } from './live'

const T0 = Date.parse('2024-03-05T00:00:00Z')
/** 產生一天 1440 根 1m K 線（Binance 陣列格式） */
function klines(start: number, n = 1440, amp = 0.01) {
  return Array.from({ length: n }, (_, i) => {
    const p = 100 + Math.sin(i / 60) * amp * 100
    return [start + i * 60_000, String(p), String(p + 0.1), String(p - 0.1), String(p + 0.05), '12.5', 0, '0', 0, '0', '0', '0']
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('live（Binance 即時資料）', () => {
  it('buildLiveDay：正規化成第一根開盤 = 100，並保留 scale', () => {
    const d = buildLiveDay(klines(T0) as never, 'BTCUSDT', '2024-03-05')!
    expect(d.candles).toHaveLength(1440)
    expect(d.candles[0]![1]).toBeCloseTo(100, 3)
    expect(d.meta).toMatchObject({ symbol: 'BTCUSDT', date: '2024-03-05', scale: 100 })
    expect(d.candles[1]![0]).toBe(60)
  })

  it('資料不足或波動太小 → null', () => {
    expect(buildLiveDay(klines(T0, 1000) as never, 'BTCUSDT', '2024-03-05')).toBeNull()
    expect(buildLiveDay(klines(T0, 1440, 0.00001) as never, 'BTCUSDT', '2024-03-05')).toBeNull()
  })

  it('fetchLiveDay：分兩次請求湊滿一天', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (u: string) => {
      urls.push(u)
      const q = new URL(u).searchParams, st = +q.get('startTime')!, en = +q.get('endTime')!
      return { ok: true, json: async () => klines(T0).filter((k) => (k[0] as number) >= st && (k[0] as number) <= en) }
    })
    const d = await fetchLiveDay('ETHUSDT', '2024-03-05')
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain('data-api.binance.vision')
    expect(d?.candles).toHaveLength(1440)
  })

  it('liveDateFor：落在範圍內且至少是前天', () => {
    const now = Date.parse('2026-10-05T12:00:00Z')
    for (let i = 0; i < 200; i++) {
      const d = liveDateFor(Math.random, now)
      expect(d >= '2023-01-01' && d <= '2026-10-03').toBe(true)
    }
  })

  it('pickLiveDay：相同種子抽到同一天；網路錯誤會丟出', async () => {
    const dates: string[] = []
    vi.stubGlobal('fetch', async (u: string) => {
      const q = new URL(u).searchParams, st = +q.get('startTime')!
      dates.push(new Date(st).toISOString().slice(0, 10))
      const day0 = Math.floor(st / 86_400_000) * 86_400_000
      return { ok: true, json: async () => klines(day0).filter((k) => (k[0] as number) >= st && (k[0] as number) <= +q.get('endTime')!) }
    })
    const a = await pickLiveDay('BTCUSDT', 123), b = await pickLiveDay('BTCUSDT', 123)
    expect(a.meta.date).toBe(b.meta.date)
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
    await expect(pickLiveDay('BTCUSDT', 123)).rejects.toThrow('Failed to fetch')
  })
})
