<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts'
import type { Candle, Game } from '../engine'

const el = ref<HTMLDivElement>()
let chart: IChartApi | null = null
let series: ISeriesApi<'Candlestick'> | null = null
let markers: ISeriesMarkersPluginApi<Time> | null = null
let drawn = 0
let markerCount = 0

let k = 1
let base = 0
const bar = (c: Candle) => ({ time: (base + c.t) as UTCTimestamp, open: c.o * k, high: c.h * k, low: c.l * k, close: c.c * k })

onMounted(() => {
  chart = createChart(el.value!, {
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: '#171c26' }, textColor: '#8a93a6' },
    grid: { vertLines: { color: '#1f2531' }, horzLines: { color: '#1f2531' } },
    rightPriceScale: { borderColor: '#262d3b' },
    timeScale: { borderColor: '#262d3b', timeVisible: true, secondsVisible: false, rightOffset: 6 },
  })
  series = chart.addSeries(CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  })
  markers = createSeriesMarkers(series, [])
})

onBeforeUnmount(() => chart?.remove())

function reset() {
  series?.setData([])
  markers?.setMarkers([])
  drawn = 0
  markerCount = 0
}

/** 把遊戲目前狀態畫上去（只補新增的部分） */
function sync(g: Game, scale = 1, baseSec = 0) {
  if (!series) return
  k = scale
  base = baseSec
  for (; drawn < g.candleIndex; drawn++) series.update(bar(g.candles[drawn]!))
  series.update(bar(g.current))
  if (g.trades.length !== markerCount) {
    markerCount = g.trades.length
    const list: SeriesMarker<Time>[] = g.trades.map((t) => ({
      time: (base + g.candles[t.candleIndex]!.t) as UTCTimestamp,
      position: t.side === 'buy' ? 'belowBar' : 'aboveBar',
      shape: t.side === 'buy' ? 'arrowUp' : 'arrowDown',
      color: t.side === 'buy' ? '#26a69a' : '#ef5350',
    }))
    markers?.setMarkers(list)
  }
}

defineExpose({ reset, sync })
</script>

<template>
  <div ref="el" class="chart"></div>
</template>

<style scoped>
.chart { width: 100%; height: 100%; min-height: 320px; }
</style>
