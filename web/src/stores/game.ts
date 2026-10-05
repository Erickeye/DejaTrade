import { defineStore } from 'pinia'
import { computed, markRaw, reactive, ref, shallowRef } from 'vue'
import { Game, OrderError, dailySeed, createRng, pickDay, pickDailyDay, toCandles } from '../engine'
import type { BracketInput, DayFile, DayIndex, Order, Settlement, Side, Trade } from '../engine'

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
  liquidationPrice: number | null
  usedMargin: number
  tp: number | null
  sl: number | null
  trail: number | null
  orders: Order[]
}

const emptySnap = (): Snapshot => ({ equity: 0, cash: 0, qty: 0, avgEntry: 0, price: 0, unrealized: 0, buyingPower: 0, progress: 0, tradeCount: 0, liquidationPrice: null, usedMargin: 0, tp: null, sl: null, trail: null, orders: [] })

export type OrderKind = 'market' | 'limit' | 'stop'

/** 下單表單（字串，直接綁定 input）。價格欄位是「顯示價格」：實況為真實價位、盲測為正規化價位。 */
export interface OrderForm {
  type: OrderKind
  amount: string
  price: string
  tp: string
  sl: string
  trailPct: string
}

function num(s: string, label: string): number | undefined {
  const t = s.trim()
  if (t === '') return undefined
  const n = Number(t.replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) throw new OrderError(`${label}格式不正確`)
  return n
}

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
  const recentTrades = ref<Trade[]>([])
  const feed = ref<string[]>([])
  const form = reactive<OrderForm>({ type: 'market', amount: '', price: '', tp: '', sl: '', trailPct: '' })
  const edit = reactive({ tp: '', sl: '', trailPct: '' })
  let acc = 0

  function refresh() {
    const g = game.value
    if (!g) return
    Object.assign(snap, {
      equity: g.equity, cash: g.cash, qty: g.qty, avgEntry: g.avgEntry, price: g.price,
      unrealized: g.unrealized, buyingPower: g.buyingPower,
      progress: (g.candleIndex + 1) / g.candles.length, tradeCount: g.trades.length,
      liquidationPrice: g.liquidationPrice, usedMargin: g.usedMargin, tp: g.tp, sl: g.sl, trail: g.trail, orders: [...g.orders],
    })
    if (recentTrades.value.length !== Math.min(g.trades.length, 8) || recentTrades.value[0] !== g.trades.at(-1)) {
      recentTrades.value = g.trades.slice(-8).reverse()
    }
    const msgs = g.drainMessages()
    if (msgs.length) feed.value = [...msgs.reverse(), ...feed.value].slice(0, 6)
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
      feed.value = []
      recentTrades.value = []
      Object.assign(form, { type: 'market', price: '', tp: '', sl: '', trailPct: '' })
      Object.assign(edit, { tp: '', sl: '', trailPct: '' })
      form.amount = String(Math.floor(game.value.buyingPower * 0.5))
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

  /** 執行一個會丟 OrderError 的動作，錯誤顯示在 notice，並同步畫面 */
  function act(fn: (g: Game) => void) {
    const g = game.value
    if (!g || phase.value !== 'playing') return
    notice.value = ''
    try {
      fn(g)
    } catch (e) {
      if (!(e instanceof OrderError)) throw e
      notice.value = e.message
    }
    refresh()
  }

  /** 切換委託類型時，預設帶入現價 */
  function fillPrice() {
    const g = game.value
    if (!g) return
    const p = g.price * display.value.k
    form.price = p.toFixed(display.value.k === 1 ? 3 : p >= 100 ? 2 : 4)
  }

  function setAmountFraction(f: number) {
    const g = game.value
    if (!g) return
    form.amount = String(Math.floor(g.buyingPower * f * (f >= 1 ? 0.99 : 1)))
  }

  function place(side: Side) {
    act((g) => {
      const k = display.value.k
      const amount = num(form.amount, '下單金額')
      if (amount === undefined) throw new OrderError('請輸入下單金額')
      let ref = g.price
      if (form.type !== 'market') {
        const p = num(form.price, '價格')
        if (p === undefined) throw new OrderError('請輸入委託價格')
        ref = p / k
      }
      const tp = num(form.tp, '止盈價'), sl = num(form.sl, '止損價'), trailPct = num(form.trailPct, '追蹤比例')
      const bracket: BracketInput = { tp: tp === undefined ? undefined : tp / k, sl: sl === undefined ? undefined : sl / k, trail: trailPct === undefined ? undefined : (ref * trailPct) / 100 }
      const qty = amount / ref
      if (form.type === 'market') (side === 'buy' ? g.buy(qty, bracket) : g.sell(qty, bracket))
      else if (form.type === 'limit') g.placeLimit(side, qty, ref, bracket)
      else g.placeStop(side, qty, ref, bracket)
    })
  }

  /** 修改持倉的止盈 / 止損 / 追蹤停損（欄位留空 = 不變） */
  function applyBracket() {
    act((g) => {
      const k = display.value.k
      const tp = num(edit.tp, '止盈價'), sl = num(edit.sl, '止損價'), trailPct = num(edit.trailPct, '追蹤比例')
      g.setBracket({ tp: tp === undefined ? undefined : tp / k, sl: sl === undefined ? undefined : sl / k, trail: trailPct === undefined ? undefined : (g.price * trailPct) / 100 })
      Object.assign(edit, { tp: '', sl: '', trailPct: '' })
    })
  }

  function clearBracket() {
    act((g) => g.setBracket({ tp: null, sl: null, trail: null }))
  }

  /** 圖上拖曳止盈 / 止損線 */
  function dragBracket(kind: 'tp' | 'sl', enginePrice: number) {
    act((g) => g.setBracket({ [kind]: enginePrice }))
  }

  function closeAll() {
    act((g) => void g.closeAll())
  }

  function closePart(fraction: number) {
    act((g) => void g.closeFraction(fraction))
  }

  function cancelOrder(id: number) {
    act((g) => void g.cancelOrder(id))
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

  return { phase, error, notice, day, game, settlement, isDaily, speedIdx, paused, leverage, liveMode, display, assetFilter, symbolFilter, symbols, isSynthetic, pool, loadIndex, snap, version, start, advance, form, edit, feed, recentTrades, fillPrice, setAmountFraction, place, applyBracket, clearBracket, dragBracket, closeAll, closePart, cancelOrder, settle, backToMenu }
})
