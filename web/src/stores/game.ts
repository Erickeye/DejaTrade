import { defineStore } from 'pinia'
import { computed, markRaw, reactive, ref, shallowRef } from 'vue'
import { Game, OrderError, dailySeed, createRng, pickDay, pickDailyDay, toCandles } from '../engine'
import type { DayFile, DayIndex, Settlement } from '../engine'

export type Phase = 'menu' | 'loading' | 'playing' | 'settled'
/** 播放倍率：1x = 真實時間（1 分鐘 K 線要跑 60 秒） */
export const SPEEDS = [1, 5, 15, 60, 300] as const
export const ASSET_LABELS: Record<string, string> = { crypto: '加密貨幣', fx: '外匯', stock: '股票' }

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
  const speedIdx = ref(0)
  const assetFilter = ref('all')
  const symbolFilter = ref('all')
  /** true = 實況模式：顯示真實日期與價格；false = 盲測（價格正規化、隱藏標的與日期） */
  const liveMode = ref(true)
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

  async function loadIndex() {
    try {
      index.value ??= await getJson<DayIndex>('index.json')
      // 題庫沒有「全部」：預設選第一個資產類別
      const first = index.value.days[0]?.asset
      if (first && !index.value.days.some((d) => d.asset === assetFilter.value)) assetFilter.value = first
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** 目前題庫：各資產類別有幾個交易日 */
  const pool = computed(() => {
    const m = new Map<string, number>()
    for (const d of index.value?.days ?? []) m.set(d.asset, (m.get(d.asset) ?? 0) + 1)
    return [...m].map(([asset, count]) => ({ asset, label: ASSET_LABELS[asset] ?? asset, count }))
  })

  /** 圖表與數字的顯示換算：k = 正規化價格 → 真實價格；base = 當日 UTC 0 點（秒） */
  const display = computed(() => {
    const d = day.value
    if (!d || !liveMode.value) return { live: false, k: 1, base: 0 }
    return { live: true, k: d.meta.scale / 100, base: Date.parse(d.meta.date + 'T00:00:00Z') / 1000 }
  })

  /** 目前題庫內的幣種（受資產類別篩選影響） */
  const symbols = computed(() => {
    const m = new Map<string, number>()
    for (const d of index.value?.days ?? []) {
      if (!d.symbol || (assetFilter.value !== 'all' && d.asset !== assetFilter.value)) continue
      m.set(d.symbol, (m.get(d.symbol) ?? 0) + 1)
    }
    return [...m].map(([symbol, count]) => ({ symbol, label: symbol.replace(/USDT$/, ''), count })).sort((a, b) => a.label.localeCompare(b.label))
  })
  const isSynthetic = computed(() => (index.value?.days ?? []).some((d) => d.synthetic))

  async function start(mode: 'random' | 'daily') {
    error.value = ''
    notice.value = ''
    phase.value = 'loading'
    try {
      await loadIndex()
      if (!index.value) throw new Error(error.value || '無法載入題庫')
      const today = new Date().toISOString().slice(0, 10)
      const seed = mode === 'daily' ? dailySeed(today) : (Math.random() * 2 ** 32) >>> 0
      const days = index.value.days.filter((d) => (assetFilter.value === 'all' || d.asset === assetFilter.value) && (symbolFilter.value === 'all' || d.symbol === symbolFilter.value))
      if (days.length === 0) throw new Error('此條件下沒有可抽的交易日')
      const scoped: DayIndex = { ...index.value, days }
      const entry = mode === 'daily' ? pickDailyDay(scoped, today) : pickDay(scoped, createRng(seed))
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
    acc += (dtMs / 1000) * (SPEEDS[speedIdx.value]! / 60) * g.ticksPerCandle
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

  return { phase, error, notice, day, game, settlement, isDaily, speedIdx, paused, leverage, liveMode, display, assetFilter, symbolFilter, symbols, isSynthetic, pool, loadIndex, snap, version, start, advance, order, closeAll, settle, backToMenu }
})
