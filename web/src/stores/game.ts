import { defineStore } from 'pinia'
import { computed, markRaw, reactive, ref, shallowRef, watch } from 'vue'
import { Game, OrderError, dailySeed, createRng, defaultLeverage, gameOptionsForDay, leverageOptions, lotNotionalUsd, lotsFromQty, pickDay, pickDailyDay, symbolLabel, toCandles, roundTrips, tradeStats, LOT_UNITS } from '../engine'
import { LIVE_SYMBOLS, liveEnabled, pickLiveDay } from '../data/live'
import { dailyRecord, getPref, openRecordStore, setPref, summarize } from '../storage/records'
import type { GameRecord, RecordStore } from '../storage/records'
import type { BracketInput, DayFile, DayIndex, Order, RoundTrip, Settlement, Side, Trade, TradeStats } from '../engine'

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
  /** 網頁版：加密貨幣即時抓取失敗時退回的靜態（合成）題庫 */
  const fallbackDays = shallowRef<DayIndex['days']>([])
  const day = shallowRef<DayFile | null>(null)
  const game = shallowRef<Game | null>(null)
  const settlement = ref<Settlement | null>(null)
  const isDaily = ref(false)
  const speedIdx = ref(0)
  const assetFilter = ref('all')
  const symbolFilter = ref('all')
  /** true = 實況模式：顯示真實日期與價格；false = 盲測（價格正規化、隱藏標的與日期） */
  const liveMode = ref(getPref('liveMode', true))
  watch(liveMode, (v) => setPref('liveMode', v))
  const paused = ref(false)
  const leverage = ref(1)
  // 切換資產類別時，槓桿回到該類別的預設值（加密貨幣 1x、外匯 30x）
  watch(assetFilter, (a) => { leverage.value = defaultLeverage(a) }, { immediate: true })
  const leverageChoices = computed(() => leverageOptions(assetFilter.value))
  // ── 戰績存檔與教學 ──
  const history = shallowRef<GameRecord[]>([])
  const persistent = ref(true)
  let recordStore: RecordStore | null = null
  const todayUtc = () => new Date().toISOString().slice(0, 10)
  const summary = computed(() => summarize(history.value, todayUtc()))
  const dailyToday = computed(() => dailyRecord(history.value, todayUtc()) ?? null)
  const tutorialOpen = ref(false)
  let pausedBeforeTutorial = false
  function openTutorial() {
    pausedBeforeTutorial = paused.value
    paused.value = true
    tutorialOpen.value = true
  }
  function closeTutorial() {
    tutorialOpen.value = false
    setPref('tutorialSeen', true)
    paused.value = pausedBeforeTutorial
  }
  async function init() {
    if (recordStore) return
    recordStore = await openRecordStore()
    persistent.value = recordStore.persistent
    history.value = await recordStore.all()
  }
  async function clearHistory() {
    await recordStore?.clear()
    history.value = []
  }
  /** 復盤資料：結算後才有 */
  const review = shallowRef<{ trips: RoundTrip[]; stats: TradeStats; equity: number[] } | null>(null)
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
      if (!index.value) {
        const idx = await getJson<DayIndex>('index.json')
        if (liveEnabled()) {
          // 加密貨幣改為「即時」：每個標的一個虛擬題目，實際日期在開局時抽
          fallbackDays.value = idx.days.filter((d) => d.asset === 'crypto')
          idx.days = [...idx.days.filter((d) => d.asset !== 'crypto'), ...LIVE_SYMBOLS.map((s) => ({ id: `live-${s}`, asset: 'crypto', symbol: s, live: true, file: '' }))]
        }
        index.value = idx
      }
      // 題庫沒有「全部」：預設選第一個資產類別
      const present = new Set(index.value.days.map((d) => d.asset))
      const first = Object.keys(ASSET_LABELS).find((a) => present.has(a)) ?? index.value.days[0]?.asset
      if (first && !index.value.days.some((d) => d.asset === assetFilter.value)) assetFilter.value = first
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** 題庫是否為即時下載（此時不顯示局數） */
  const isLive = (asset: string) => (index.value?.days ?? []).some((d) => d.asset === asset && d.live)

  /** 目前題庫：各資產類別有幾個交易日 */
  const pool = computed(() => {
    const m = new Map<string, number>()
    for (const d of index.value?.days ?? []) m.set(d.asset, (m.get(d.asset) ?? 0) + 1)
    return [...m].map(([asset, count]) => ({ asset, label: ASSET_LABELS[asset] ?? asset, count, live: isLive(asset) }))
  })

  /** 圖表與數字的顯示換算：k = 正規化價格 → 真實價格；base = 當日 UTC 0 點（秒） */
  const display = computed(() => {
    const d = day.value
    const lots = d && d.asset === 'fx' ? (qty: number, p: number) => lotsFromQty(d.meta, qty, p, d.meta.scale / 100) : undefined
    if (!d || !liveMode.value) return { live: false, k: 1, base: 0, digits: undefined as number | undefined, lots }
    return { live: true, k: d.meta.scale / 100, base: Date.parse(d.meta.date + 'T00:00:00Z') / 1000, digits: d.asset === 'fx' ? d.meta.digits : undefined, lots }
  })
  const isFx = computed(() => day.value?.asset === 'fx')
  /** 正規化價格 → 真實價格的倍率（盲測時畫面 k = 1，但手數換算仍需真實價位） */
  const realK = computed(() => (day.value ? day.value.meta.scale / 100 : 1))

  /** 目前題庫內的幣種（受資產類別篩選影響） */
  const symbols = computed(() => {
    const m = new Map<string, number>()
    for (const d of index.value?.days ?? []) {
      if (!d.symbol || (assetFilter.value !== 'all' && d.asset !== assetFilter.value)) continue
      m.set(d.symbol, (m.get(d.symbol) ?? 0) + 1)
    }
    return [...m].map(([symbol, count]) => ({ symbol, label: symbolLabel(symbol, assetFilter.value), count, live: isLive(assetFilter.value) })).sort((a, b) => a.label.localeCompare(b.label))
  })
  const isSynthetic = computed(() => (index.value?.days ?? []).some((d) => d.synthetic && d.asset === assetFilter.value))

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
      if (entry.live) {
        try {
          day.value = await pickLiveDay(entry.symbol!, (seed ^ 0x9e3779b9) >>> 0)
        } catch (e) {
          // 瀏覽器連不上 Binance（離線 / 被擋）→ 退回合成資料，並明確告知
          const fb = fallbackDays.value
          if (fb.length === 0) throw new Error(`無法取得 ${symbolLabel(entry.symbol!, 'crypto')} 的即時歷史資料：${e instanceof Error ? e.message : e}`)
          day.value = await getJson<DayFile>(pickDay({ version: 1, days: fb }, createRng(seed)).file)
          notice.value = '無法連線到 Binance，這局改用合成資料。'
        }
      } else day.value = await getJson<DayFile>(entry.file)
      game.value = markRaw(new Game(toCandles(day.value), gameOptionsForDay(day.value.asset, day.value.meta, leverage.value, seed)))
      isDaily.value = mode === 'daily'
      settlement.value = null
      review.value = null
      paused.value = false
      acc = 0
      phase.value = 'playing'
      feed.value = []
      recentTrades.value = []
      Object.assign(form, { type: 'market', price: '', tp: '', sl: '', trailPct: '' })
      Object.assign(edit, { tp: '', sl: '', trailPct: '' })
      form.amount = ''
      setAmountFraction(0.5)
      refresh()
      if (!getPref('tutorialSeen', false)) openTutorial()
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
    form.price = p.toFixed(display.value.digits ?? (display.value.k === 1 ? 3 : p >= 100 ? 2 : 4))
  }

  /** 外匯下單單位是「手」，加密貨幣是 USD 金額 */
  function setAmountFraction(f: number) {
    const g = game.value
    if (!g) return
    const usd = g.buyingPower * f * (f >= 1 ? 0.99 : 1)
    if (isFx.value && day.value) {
      const lot = lotNotionalUsd(day.value.meta, g.price * realK.value)
      form.amount = (Math.floor((usd / lot) * 100) / 100).toFixed(2)
    } else {
      form.amount = String(Math.floor(usd))
    }
  }

  /** 目前還能再開多少：usd = 名目金額；size = 下單欄位單位（外匯為手數，加密貨幣為 USD） */
  const maxOpen = computed(() => {
    void version.value
    const g = game.value
    if (!g) return null
    const usd = Math.max(0, g.buyingPower)
    if (isFx.value && day.value) {
      const lot = lotNotionalUsd(day.value.meta, g.price * realK.value)
      return { usd, size: Math.floor((usd / lot) * 100) / 100 }
    }
    return { usd, size: Math.floor(usd) }
  })

  /** 下單前的風險預覽：保證金、每 pip 價值、止損最大虧損（依目前表單內容） */
  const risk = computed(() => {
    void version.value
    const g = game.value, d = day.value
    if (!g || !d || phase.value !== 'playing') return null
    const size = Number(form.amount.replace(/,/g, ''))
    const refNorm = form.type === 'market' ? g.price : Number(form.price.replace(/,/g, '')) / display.value.k
    if (!(size > 0) || !(refNorm > 0)) return null
    const real = refNorm * realK.value
    const notional = isFx.value ? size * lotNotionalUsd(d.meta, real) : size
    const slDisp = Number(form.sl.replace(/,/g, ''))
    const slNorm = slDisp > 0 ? slDisp / display.value.k : null
    const slDist = slNorm != null ? Math.abs(refNorm - slNorm) : null
    const maxLoss = slDist != null ? (notional * slDist) / refNorm : null
    const pip = d.meta.pipSize
    const pipUsd = isFx.value && pip ? (size * LOT_UNITS * pip) / (d.meta.usdIsQuote === false ? real : 1) : null
    const slPips = isFx.value && pip && slDist != null ? (slDist * realK.value) / pip : null
    return { notional, margin: notional / g.leverage, pipUsd, maxLoss, maxLossPct: maxLoss != null ? (maxLoss / Math.max(g.equity, 1e-9)) * 100 : null, slPips, hasSl: slNorm != null }
  })

  function place(side: Side) {
    act((g) => {
      const k = display.value.k
      const size = num(form.amount, isFx.value ? '手數' : '下單金額')
      if (size === undefined) throw new OrderError(isFx.value ? '請輸入手數' : '請輸入下單金額')
      let ref = g.price
      if (form.type !== 'market') {
        const p = num(form.price, '價格')
        if (p === undefined) throw new OrderError('請輸入委託價格')
        ref = p / k
      }
      // 外匯以手數下單：換算成美元名目金額
      const amount = isFx.value && day.value ? size * lotNotionalUsd(day.value.meta, ref * realK.value) : size
      const tp = num(form.tp, '止盈價'), sl = num(form.sl, '止損價'), trailPct = num(form.trailPct, '追蹤比例')
      const bracket: BracketInput = { tp: tp === undefined ? undefined : tp / k, sl: sl === undefined ? undefined : sl / k, trail: trailPct === undefined ? undefined : (ref * trailPct) / 100 }
      const qty = amount / ref
      const adds = g.qty === 0 || (g.qty > 0) === (side === 'buy')
      const room = g.buyingPower
      if (adds && amount > room * 1.0001) {
        const unit = isFx.value ? '手' : ' USD'
        throw new OrderError(`超過可用額度：這筆名目 $${Math.round(amount).toLocaleString()}，但目前只剩 $${Math.round(Math.max(room, 0)).toLocaleString()} 可用（淨值 × ${g.leverage} 倍槓桿，減掉已持有部位）。最多還能下 ${maxOpen.value?.size ?? 0}${unit}。`)
      }
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
    const st = g.settle()
    settlement.value = st
    const trips = roundTrips(g.trades)
    const stats = tradeStats(trips)
    review.value = { trips, stats, equity: st.equityCurve }
    refresh()
    phase.value = 'settled'
    saveRecord(st, stats)
  }

  function saveRecord(st: Settlement, stats: TradeStats) {
    const d = day.value
    if (!d || !recordStore) return
    const rec: GameRecord = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      daily: isDaily.value,
      dailyDate: isDaily.value ? todayUtc() : undefined,
      blind: !liveMode.value,
      asset: d.asset,
      symbol: d.meta.symbol,
      date: d.meta.date,
      synthetic: !!d.meta.synthetic,
      leverage: leverage.value,
      pnl: st.pnl,
      pnlPct: st.pnlPct,
      trades: stats.count,
      winRate: stats.winRate,
      maxDrawdownPct: st.maxDrawdownPct,
      liquidated: st.liquidated,
    }
    history.value = [...history.value, rec]
    void recordStore.add(rec).catch(() => { persistent.value = false })
  }

  function backToMenu() {
    phase.value = 'menu'
  }

  return { phase, error, notice, day, game, settlement, isDaily, speedIdx, paused, leverage, liveMode, display, isFx, leverageChoices, assetFilter, symbolFilter, symbols, isSynthetic, pool, loadIndex, snap, version, start, advance, form, edit, feed, recentTrades, fillPrice, setAmountFraction, place, applyBracket, clearBracket, dragBracket, closeAll, closePart, cancelOrder, settle, backToMenu, init, history, persistent, summary, dailyToday, clearHistory, tutorialOpen, openTutorial, closeTutorial, review, risk, maxOpen }
})
