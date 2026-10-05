<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers } from 'lightweight-charts'
import type { AutoscaleInfo, IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, MouseEventParams, SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts'
import { BarBuilder, Indicators } from '../engine'
import type { Bar, Game, IndicatorValues } from '../engine'
import type { ChartDisplay, IndicatorToggles } from './chart-options'

const props = defineProps<{ timeframe: number; indicators: IndicatorToggles; display: ChartDisplay }>()
const emit = defineEmits<{ (e: 'drag-bracket', kind: 'tp' | 'sl', enginePrice: number): void }>()

const el = ref<HTMLDivElement>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Series = ISeriesApi<any>

let chart: IChartApi | null = null
let candle: ISeriesApi<'Candlestick'> | null = null
let volume: ISeriesApi<'Histogram'> | null = null
let markers: ISeriesMarkersPluginApi<Time> | null = null
let ind: Record<string, Series> = {}
let builder = new BarBuilder(1)
let calc = new Indicators()
let lastGame: Game | null = null
let markerCount = -1
const lines = new Map<string, { line: IPriceLine; price: number }>()
let drag: { kind: 'tp' | 'sl'; price: number } | null = null
let hovering = false

// ───── 圖例（十字游標 OHLC） ─────
interface LegendRow { label: string; color: string; value: string }
const legend = ref<{ o: number; h: number; l: number; c: number; v: number; chg: number } | null>(null)
const legendInds = ref<LegendRow[]>([])
let latest: typeof legend.value = null

const IND_STYLE: Record<string, { color: string; label: string }> = {
  sma: { color: '#f5b942', label: 'SMA20' },
  ema: { color: '#4fc3f7', label: 'EMA20' },
  vwap: { color: '#ba68c8', label: 'VWAP' },
  bbU: { color: '#7986cb', label: 'BB上' },
  bbM: { color: '#7986cb', label: 'BB中' },
  bbL: { color: '#7986cb', label: 'BB下' },
  rsi: { color: '#f5b942', label: 'RSI' },
  macd: { color: '#4fc3f7', label: 'MACD' },
  macdSig: { color: '#f5b942', label: '訊號' },
  macdHist: { color: '#8a93a6', label: '柱' },
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 2 : n >= 10 ? 3 : 4 })
const px = (n: number) => fmt(n)

function pick(key: string, v: IndicatorValues, k: number): number | undefined {
  const s = (x: number | undefined) => (x === undefined ? undefined : x * k)
  switch (key) {
    case 'sma': return s(v.sma)
    case 'ema': return s(v.ema)
    case 'vwap': return s(v.vwap)
    case 'bbU': return s(v.bbUpper)
    case 'bbM': return s(v.bbMid)
    case 'bbL': return s(v.bbLower)
    case 'rsi': return v.rsi
    case 'macd': return s(v.macd)
    case 'macdSig': return s(v.macdSignal)
    case 'macdHist': return s(v.macdHist)
  }
}

const time = (t: number) => (props.display.base + t) as UTCTimestamp
const toCandle = (b: Bar) => {
  const k = props.display.k
  return { time: time(b.t), open: b.o * k, high: b.h * k, low: b.l * k, close: b.c * k }
}
const toVolume = (b: Bar) => ({ time: time(b.t), value: b.v, color: b.c >= b.o ? '#26a69a66' : '#ef535066' })

// ───── 建立 / 銷毀 ─────
onMounted(() => {
  chart = createChart(el.value!, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: '#171c26' }, textColor: '#8a93a6', panes: { separatorColor: '#262d3b' } },
    grid: { vertLines: { color: '#1f2531' }, horzLines: { color: '#1f2531' } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#262d3b', scaleMargins: { top: 0.14, bottom: 0.22 } },
    timeScale: { borderColor: '#262d3b', timeVisible: true, secondsVisible: false, rightOffset: 6 },
  })
  candle = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    // 讓自動縮放把均價 / 止盈 / 止損 / 掛單線也納入，才拖得到、看得到
    autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
      const res = original()
      if (!res?.priceRange) return res
      let min = res.priceRange.minValue
      let max = res.priceRange.maxValue
      for (const [key, l] of lines) {
        if (key === 'liq' || key.startsWith('order-')) continue
        min = Math.min(min, l.price)
        max = Math.max(max, l.price)
      }
      return { ...res, priceRange: { minValue: min, maxValue: max } }
    },
  })
  volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false })
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
  markers = createSeriesMarkers(candle, [])
  chart.subscribeCrosshairMove(onCrosshair)
  el.value!.addEventListener('pointerdown', onPointerDown, true)
  el.value!.addEventListener('pointermove', onHoverMove)
  buildIndicatorSeries()
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  chart?.remove()
})

// ───── 指標序列（依開關建立；RSI / MACD 各佔一個副圖） ─────
function buildIndicatorSeries() {
  if (!chart) return
  for (const s of Object.values(ind)) chart.removeSeries(s)
  ind = {}
  while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1)
  const t = props.indicators
  const line = (key: string, pane = 0, extra: object = {}) => {
    ind[key] = chart!.addSeries(LineSeries, { color: IND_STYLE[key]!.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra }, pane)
  }
  if (t.sma) line('sma')
  if (t.ema) line('ema')
  if (t.vwap) line('vwap')
  if (t.bb) {
    line('bbU', 0, { lineStyle: LineStyle.Dashed })
    line('bbM', 0, { lineStyle: LineStyle.Dotted })
    line('bbL', 0, { lineStyle: LineStyle.Dashed })
  }
  let pane = 1
  if (t.rsi) {
    line('rsi', pane, { lastValueVisible: true })
    ind.rsi!.createPriceLine({ price: 70, color: '#8a93a6', lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: '' })
    ind.rsi!.createPriceLine({ price: 30, color: '#8a93a6', lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false, title: '' })
    pane++
  }
  if (t.macd) {
    ind.macdHist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane)
    line('macd', pane)
    line('macdSig', pane)
  }
  const panes = chart.panes()
  panes[0]?.setStretchFactor(4)
  for (let i = 1; i < panes.length; i++) panes[i]!.setStretchFactor(1.2)
}

const hist = (v: number | undefined, t: UTCTimestamp) =>
  v === undefined ? { time: t } : { time: t, value: v, color: v >= 0 ? '#26a69a99' : '#ef535099' }

function pushIndicator(key: string, v: IndicatorValues, t: UTCTimestamp, set: boolean, acc?: Record<string, object[]>) {
  const s = ind[key]
  if (!s) return
  const val = pick(key, v, props.display.k)
  if (val === undefined) return
  const point = key === 'macdHist' ? hist(val, t) : { time: t, value: val }
  if (acc) (acc[key] ??= []).push(point)
  else if (!set) s.update(point)
}

/** 依目前週期 / 指標設定，從頭重畫整張圖 */
function rebuild() {
  if (!chart || !candle || !volume) return
  const g = lastGame
  builder = new BarBuilder(props.timeframe)
  calc = new Indicators()
  markerCount = -1
  clearLines()
  candle.setData([])
  volume.setData([])
  for (const s of Object.values(ind)) s.setData([])
  if (!g) return
  candle.applyOptions({ priceFormat: { type: 'price', precision: props.display.k === 1 ? 3 : g.current.c * props.display.k >= 100 ? 2 : 4, minMove: props.display.k === 1 ? 0.001 : 0.01 } })

  const { closed, live } = builder.update(g.candles, g.candleIndex, g.current)
  const acc: Record<string, object[]> = {}
  for (const b of closed) {
    const v = calc.pushClosed(b)
    for (const key of Object.keys(ind)) pushIndicator(key, v, time(b.t), true, acc)
  }
  candle.setData(closed.map(toCandle))
  volume.setData(closed.map(toVolume))
  for (const [key, data] of Object.entries(acc)) ind[key]!.setData(data as never)
  drawLive(live)
  chart.timeScale().applyOptions({ barSpacing: 8 })
  chart.timeScale().scrollToRealTime()
}

function drawLive(live: Bar) {
  candle!.update(toCandle(live))
  volume!.update(toVolume(live))
  const v = calc.peek(live)
  for (const key of Object.keys(ind)) pushIndicator(key, v, time(live.t), false)
  const k = props.display.k
  latest = { o: live.o * k, h: live.h * k, l: live.l * k, c: live.c * k, v: live.v, chg: live.o ? (live.c / live.o - 1) * 100 : 0 }
  if (!hovering) {
    legend.value = latest
    legendInds.value = Object.keys(ind).filter((key) => key !== 'macdHist').map((key) => {
      const val = pick(key, v, k)
      return { label: IND_STYLE[key]!.label, color: IND_STYLE[key]!.color, value: val === undefined ? '—' : px(val) }
    })
  }
}

// ───── 同步遊戲狀態 ─────
function reset() {
  lastGame = null
  rebuild()
}

/** 把遊戲目前狀態畫上去（只補新增的部分） */
function sync(g: Game) {
  if (!chart || !candle || !volume) return
  if (lastGame !== g) {
    lastGame = g
    rebuild()
  } else {
    const { closed, live } = builder.update(g.candles, g.candleIndex, g.current)
    for (const b of closed) {
      candle.update(toCandle(b))
      volume.update(toVolume(b))
      const v = calc.pushClosed(b)
      for (const key of Object.keys(ind)) pushIndicator(key, v, time(b.t), false)
    }
    drawLive(live)
  }
  syncMarkers(g)
  syncLines(g)
}

watch(() => props.timeframe, () => rebuild())
watch(() => props.indicators, () => { buildIndicatorSeries(); rebuild() }, { deep: true })

// ───── 成交標記 ─────
const REASON_TEXT: Record<string, string> = { tp: 'TP', sl: 'SL', liquidation: '強平', limit: '限', stop: '停' }
function syncMarkers(g: Game) {
  if (g.trades.length === markerCount) return
  markerCount = g.trades.length
  const tf = builder.tfSec
  const list: SeriesMarker<Time>[] = g.trades.map((t) => ({
    time: time(Math.floor(g.candles[t.candleIndex]!.t / tf) * tf),
    position: t.side === 'buy' ? 'belowBar' : 'aboveBar',
    shape: t.side === 'buy' ? 'arrowUp' : 'arrowDown',
    color: t.reason === 'liquidation' ? '#ff9800' : t.side === 'buy' ? '#26a69a' : '#ef5350',
    text: REASON_TEXT[t.reason] ?? '',
  }))
  markers?.setMarkers(list)
}

// ───── 價格線：均價 / 止盈 / 止損 / 強平 / 掛單 ─────
function setLine(key: string, price: number | null, opts: { color: string; title: string; style?: LineStyle; width?: 1 | 2 }) {
  if (!candle) return
  const cur = lines.get(key)
  if (price == null || !Number.isFinite(price)) {
    if (cur) { candle.removePriceLine(cur.line); lines.delete(key) }
    return
  }
  const o = { price, color: opts.color, title: opts.title, lineStyle: opts.style ?? LineStyle.Dashed, lineWidth: opts.width ?? 1, axisLabelVisible: true }
  if (cur) { cur.line.applyOptions(o); cur.price = price } else lines.set(key, { line: candle.createPriceLine(o), price })
}

function clearLines() {
  for (const { line } of lines.values()) candle?.removePriceLine(line)
  lines.clear()
}

function syncLines(g: Game) {
  const k = props.display.k
  const pnlText = (p: number) => {
    const v = g.qty * (p / k - g.avgEntry)
    return (v >= 0 ? '+' : '') + v.toFixed(2)
  }
  const holding = g.qty !== 0
  setLine('entry', holding ? g.avgEntry * k : null, { color: '#9aa4b8', title: `${g.qty > 0 ? '多' : '空'} ${fmt(Math.abs(g.qty) / k)}`, style: LineStyle.Solid })
  if (!(drag?.kind === 'tp')) setLine('tp', holding && g.tp != null ? g.tp * k : null, { color: '#26a69a', title: g.tp != null ? `止盈 ${pnlText(g.tp * k)}` : '', width: 2 })
  if (!(drag?.kind === 'sl')) setLine('sl', holding && g.sl != null ? g.sl * k : null, { color: '#ef5350', title: g.sl != null ? `${g.trail != null ? '追蹤止損' : '止損'} ${pnlText(g.sl * k)}` : '', width: 2 })
  const lp = g.liquidationPrice
  setLine('liq', holding && lp != null ? lp * k : null, { color: '#ff9800', title: '強平價', style: LineStyle.Dotted })
  const ids = new Set(g.orders.map((o) => `order-${o.id}`))
  for (const key of [...lines.keys()]) if (key.startsWith('order-') && !ids.has(key)) setLine(key, null, { color: '', title: '' })
  for (const o of g.orders) {
    setLine(`order-${o.id}`, o.price * k, { color: '#f5b942', title: `${o.type === 'limit' ? '限價' : '停損'}${o.side === 'buy' ? '買' : '賣'} ${fmt(o.qty / k)}`, style: LineStyle.SparseDotted })
  }
}

// ───── 拖曳止盈 / 止損線 ─────
function nearKey(y: number): 'tp' | 'sl' | null {
  if (!candle) return null
  for (const key of ['tp', 'sl'] as const) {
    const l = lines.get(key)
    if (!l) continue
    const cy = candle.priceToCoordinate(l.price)
    if (cy != null && Math.abs(cy - y) <= 6) return key
  }
  return null
}

const localY = (e: PointerEvent) => e.clientY - el.value!.getBoundingClientRect().top

function onHoverMove(e: PointerEvent) {
  if (drag) return
  el.value!.style.cursor = nearKey(localY(e)) ? 'ns-resize' : ''
}

function onPointerDown(e: PointerEvent) {
  const key = nearKey(localY(e))
  if (!key) return
  e.stopPropagation()
  e.preventDefault()
  drag = { kind: key, price: lines.get(key)!.price }
  chart!.applyOptions({ handleScroll: false, handleScale: false })
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}

function onDragMove(e: PointerEvent) {
  if (!drag || !candle) return
  const p = candle.coordinateToPrice(localY(e))
  if (p == null) return
  drag.price = p
  const cur = lines.get(drag.kind)
  if (cur) { cur.line.applyOptions({ price: p }); cur.price = p }
}

function onDragEnd() {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  chart?.applyOptions({ handleScroll: true, handleScale: true })
  const d = drag
  drag = null
  if (!d) return
  emit('drag-bracket', d.kind, d.price / props.display.k)
  if (lastGame) syncLines(lastGame) // 若引擎拒絕（方向錯誤），線會回到原位
}

// ───── 十字游標圖例 ─────
function onCrosshair(p: MouseEventParams<Time>) {
  const b = candle && p.seriesData.get(candle) as { open: number; high: number; low: number; close: number } | undefined
  if (!p.time || !b) {
    hovering = false
    if (latest) legend.value = latest
    return
  }
  hovering = true
  const vol = volume && (p.seriesData.get(volume) as { value: number } | undefined)
  legend.value = { o: b.open, h: b.high, l: b.low, c: b.close, v: vol?.value ?? 0, chg: b.open ? (b.close / b.open - 1) * 100 : 0 }
  legendInds.value = Object.entries(ind).filter(([key]) => key !== 'macdHist').map(([key, s]) => {
    const d = p.seriesData.get(s) as { value?: number } | undefined
    return { label: IND_STYLE[key]!.label, color: IND_STYLE[key]!.color, value: d?.value === undefined ? '—' : px(d.value) }
  })
}

defineExpose({ reset, sync })
</script>

<template>
  <div class="wrap">
    <div ref="el" class="chart"></div>
    <div v-if="legend" class="legend">
      <span>O <b>{{ px(legend.o) }}</b></span>
      <span>H <b>{{ px(legend.h) }}</b></span>
      <span>L <b>{{ px(legend.l) }}</b></span>
      <span>C <b>{{ px(legend.c) }}</b></span>
      <span :class="legend.chg >= 0 ? 'up' : 'down'">{{ legend.chg >= 0 ? '+' : '' }}{{ legend.chg.toFixed(2) }}%</span>
      <span>量 <b>{{ fmt(legend.v) }}</b></span>
      <span v-for="r in legendInds" :key="r.label" :style="{ color: r.color }">{{ r.label }} {{ r.value }}</span>
    </div>
  </div>
</template>

<style scoped>
.wrap { position: relative; width: 100%; height: 100%; }
.chart { width: 100%; height: 100%; min-height: 320px; }
.legend { position: absolute; top: 6px; left: 10px; z-index: 5; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--dim); pointer-events: none; font-variant-numeric: tabular-nums; }
.legend b { color: var(--text); font-weight: 500; }
</style>
