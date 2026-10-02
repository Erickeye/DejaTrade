import { defineStore } from 'pinia'
import { markRaw, reactive, ref, shallowRef } from 'vue'
import { Game, OrderError, dailySeed, createRng, pickDay, pickDailyDay, toCandles } from '../engine'
import type { DayFile, DayIndex, Settlement } from '../engine'

export type Phase = 'menu' | 'loading' | 'playing' | 'settled'
export const SPEEDS = [2, 6, 20, 60] as const // 每秒播放幾根 K 線

const base = import.meta.env.BASE_URL

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}data/${path}`)
  if (!res.ok) throw new Error(`載入失敗：${path}（${res.status}）`)
  return res.json() as Promise<T>
}

/** 給畫面用的輕量快照，每個 tick 更新一次 */
export interface Snapshot {
  equity: number
  cash: number
  qty: number
  avgEntry: number
  price: number
  unrealized: number
  buyingPower: number
  progress: number
  tradeCount: number
}

const emptySnap = (): Snapshot => ({ equity: 0, cash: 0, qty: 0, avgEntry: 0, price: 0, unrealized: 0, buyingPower: 0, progress: 0, tradeCount: 0 })

export const useGameStore = defineStore('game', () => {
  const phase = ref<Phase>('menu')
  const error = ref('')
  const notice = ref('')
  const index = shallowRef<DayIndex | null>(null)
  const day = shallowRef<DayFile | null>(null)
  const game = shallowRef<Game | null>(null)
  const settlement = ref<Settlement | null>(null)
  const isDaily = ref(false)
  const speedIdx = ref(1)
  const paused = ref(false)
  const leverage = ref(1)
  const snap = reactive<Snapshot>(emptySnap())
  const version = ref(0) // 每次畫面需要同步圖表時 +1
  let acc = 0

  function refresh() {
    const g = game.value
    if (!g) return
    Object.assign(snap, {
      equity: g.equity, cash: g.cash, qty: g.qty, avgEntry: g.avgEntry, price: g.price,
      unrealized: g.unrealized, buyingPower: g.buyingPower,
      progress: (g.candleIndex + 1) / g.candles.length, tradeCount: g.trades.length,
    })
    version.value++
  }

  async function start(mode: 'random' | 'daily') {
    error.value = ''
    notice.value = ''
    phase.value = 'loading'
    try {
      index.value ??= await getJson<DayIndex>('index.json')
      const today = new Date().toISOString().slice(0, 10)
      const seed = mode === 'daily' ? dailySeed(today) : (Math.random() * 2 ** 32) >>> 0
      const entry = mode === 'daily' ? pickDailyDay(index.value, today) : pickDay(index.value, createRng(seed))
      day.value = await getJson<DayFile>(entry.file)
      game.value = markRaw(new Game(toCandles(day.value), { seed, leverage: leverage.value }))
      isDaily.value = mode === 'daily'
      settlement.value = null
      paused.value = false
      acc = 0
      phase.value = 'playing'
      refresh()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      phase.value = 'menu'
    }
  }

  /** 由畫面的 rAF 迴圈呼叫 */
  function advance(dtMs: number) {
    const g = game.value
    if (phase.value !== 'playing' || paused.value || !g) return
    acc += (dtMs / 1000) * SPEEDS[speedIdx.value]! * g.ticksPerCandle
    let n = Math.floor(acc)
    acc -= n
    while (n-- > 0 && g.step());
    refresh()
    if (g.finished) settle()
  }

  function order(kind: 'buy' | 'sell', fraction: number) {
    const g = game.value
    if (!g || phase.value !== 'playing') return
    notice.value = ''
    try {
      const amount = g.buyingPower * fraction
      if (kind === 'buy') g.buyNotional(amount)
      else g.sellNotional(amount)
    } catch (e) {
      notice.value = e instanceof OrderError ? e.message : String(e)
    }
    refresh()
  }

  function closeAll() {
    game.value?.closeAll()
    refresh()
  }

  function settle() {
    const g = game.value
    if (!g || phase.value !== 'playing') return
    settlement.value = g.settle()
    refresh()
    phase.value = 'settled'
  }

  function backToMenu() {
    phase.value = 'menu'
  }

  return { phase, error, notice, day, game, settlement, isDaily, speedIdx, paused, leverage, snap, version, start, advance, order, closeAll, settle, backToMenu }
})
