<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CandleChart from '../components/CandleChart.vue'
import { ASSET_LABELS, SPEEDS, useGameStore } from '../stores/game'

const store = useGameStore()
const chart = ref<InstanceType<typeof CandleChart>>()
const fraction = ref(0.5)
const fractions = [0.25, 0.5, 1]

let raf = 0
let last = 0
function loop(now: number) {
  store.advance(Math.min(now - last, 100))
  last = now
  raf = requestAnimationFrame(loop)
}
onMounted(() => { store.loadIndex(); last = performance.now(); raf = requestAnimationFrame(loop) })
onBeforeUnmount(() => cancelAnimationFrame(raf))

watch(() => store.version, () => { if (store.game) chart.value?.sync(store.game, store.display.k, store.display.base) })
watch(() => store.phase, (p) => { if (p === 'playing') chart.value?.reset() })

const fmt = (n: number, d = 2) => n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d })
const signed = (n: number, d = 2) => (n > 0 ? '+' : '') + fmt(n, d)
const cls = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'dim')

const positionText = computed(() => {
  const s = store.snap
  if (s.qty === 0) return '空手'
  const k = store.display.k
  return `${s.qty > 0 ? '多' : '空'} ${fmt(Math.abs(s.qty) / k, 4)} @ ${fmt(s.avgEntry * k)}`
})
const equityPct = computed(() => ((store.snap.equity / (store.game?.initialCash ?? 1)) - 1) * 100)

// 局後揭曉：把正規化價格換回真實價位
const reveal = computed(() => {
  const d = store.day, g = store.game
  if (!d || !g) return null
  const k = d.meta.scale / 100
  const lows = g.candles.map((c) => c.l), highs = g.candles.map((c) => c.h)
  return {
    ...d.meta,
    open: g.candles[0]!.o * k,
    close: g.candles.at(-1)!.c * k,
    low: Math.min(...lows) * k,
    high: Math.max(...highs) * k,
  }
})
</script>

<template>
  <div class="app">
    <header>
      <h1>DejaTrade <span class="dim">當沖模擬器</span></h1>
      <span v-if="store.phase === 'playing' && store.isDaily" class="tag">每日挑戰</span>
      <span v-if="store.day && store.phase === 'playing'" class="tag alt">
        <template v-if="store.display.live">{{ store.day.meta.symbol.replace(/USDT$/, '') }} · {{ store.day.meta.date }}（UTC）· {{ store.day.interval }} K 線</template>
        <template v-else>{{ ASSET_LABELS[store.day.asset] ?? store.day.asset }} · {{ store.day.interval }} K 線 · 盲測</template>
        <template v-if="store.day.meta.synthetic"> · 合成資料</template>
      </span>
    </header>

    <!-- 主選單 -->
    <section v-if="store.phase === 'menu' || store.phase === 'loading'" class="card menu">
      <p>隨機抽一個歷史交易日，逐根播放，自己決定進出場。盲測模式會隱藏標的與日期、價格從 100 開始，結算後才揭曉答案。</p>
      <div class="row">
        <span class="dim">模式</span>
        <button :class="{ on: store.liveMode }" @click="store.liveMode = true">實況（顯示日期與真實價格）</button>
        <button :class="{ on: !store.liveMode }" @click="store.liveMode = false">盲測</button>
      </div>
      <div class="row">
        <span class="dim">題庫</span>
        <button v-for="p in store.pool" :key="p.asset" :class="{ on: store.assetFilter === p.asset }" @click="store.assetFilter = p.asset">{{ p.label }}</button>
      </div>
      <div v-if="store.symbols.length" class="row">
        <span class="dim">幣種</span>
        <button :class="{ on: store.symbolFilter === 'all' }" @click="store.symbolFilter = 'all'">全部（盲測）</button>
        <button v-for="s in store.symbols" :key="s.symbol" :class="{ on: store.symbolFilter === s.symbol }" @click="store.symbolFilter = s.symbol">{{ s.label }}（{{ s.count }}）</button>
      </div>
      <p v-if="store.isSynthetic" class="dim small">目前題庫為開發用的合成資料，並非真實行情。</p>
      <p v-else-if="store.liveMode" class="dim small">實況模式：顯示真實日期與價格（時間為 UTC）。</p>
      <p v-else class="dim small">盲測模式：標的與日期隱藏，結算後才揭曉。</p>
      <div class="row">
        <span class="dim">槓桿</span>
        <button v-for="l in [1, 5, 20]" :key="l" :class="{ on: store.leverage === l }" @click="store.leverage = l">{{ l }}x</button>
      </div>
      <div class="row">
        <button class="primary" :disabled="store.phase === 'loading'" @click="store.start('random')">隨機一局</button>
        <button :disabled="store.phase === 'loading'" @click="store.start('daily')">今日挑戰</button>
      </div>
      <p v-if="store.phase === 'loading'" class="dim">載入中…</p>
      <p v-if="store.error" class="down">{{ store.error }}</p>
    </section>

    <!-- 遊戲中 / 結算 共用圖表 -->
    <main v-show="store.phase === 'playing' || store.phase === 'settled'" class="play">
      <div class="chartbox"><CandleChart ref="chart" /></div>

      <aside class="side">
        <div class="card stats">
          <div><span class="dim">淨值</span><b>{{ fmt(store.snap.equity) }}</b> <small :class="cls(equityPct)">{{ signed(equityPct) }}%</small></div>
          <div><span class="dim">現價</span><b>{{ fmt(store.snap.price * store.display.k) }}</b></div>
          <div><span class="dim">部位</span><b>{{ positionText }}</b></div>
          <div><span class="dim">未實現</span><b :class="cls(store.snap.unrealized)">{{ signed(store.snap.unrealized) }}</b></div>
          <div><span class="dim">可用額度</span><b>{{ fmt(store.snap.buyingPower, 0) }}</b></div>
          <div class="bar"><i :style="{ width: store.snap.progress * 100 + '%' }"></i></div>
        </div>

        <template v-if="store.phase === 'playing'">
          <div class="card">
            <div class="row">
              <span class="dim">每次下單</span>
              <button v-for="f in fractions" :key="f" :class="{ on: fraction === f }" @click="fraction = f">{{ f * 100 }}%</button>
            </div>
            <div class="row">
              <button class="buy" @click="store.order('buy', fraction)">買進 / 做多</button>
              <button class="sell" @click="store.order('sell', fraction)">賣出 / 做空</button>
            </div>
            <div class="row">
              <button :disabled="store.snap.qty === 0" @click="store.closeAll()">全部平倉</button>
              <button @click="store.settle()">結算本局</button>
            </div>
            <p v-if="store.notice" class="down small">{{ store.notice }}</p>
          </div>
          <div class="card">
            <div class="row">
              <button @click="store.paused = !store.paused">{{ store.paused ? '▶ 繼續' : '⏸ 暫停' }}</button>
              <button v-for="(s, i) in SPEEDS" :key="s" :class="{ on: store.speedIdx === i }" @click="store.speedIdx = i">{{ s }}x</button>
            </div>
            <div class="dim small">1x = 真實時間（1 分鐘 K 線跑 60 秒），可自行加速
            </div>
          </div>
        </template>

        <div v-else-if="store.settlement" class="card result">
          <h2 :class="cls(store.settlement.pnl)">
            {{ store.settlement.liquidated ? '💥 爆倉' : '結算' }} {{ signed(store.settlement.pnl) }}（{{ signed(store.settlement.pnlPct) }}%）
          </h2>
          <ul>
            <li>最終資金 {{ fmt(store.settlement.finalEquity) }}</li>
            <li>交易 {{ store.settlement.trades }} 筆，手續費 {{ fmt(store.settlement.totalFees) }}</li>
            <li>最大回撤 {{ fmt(store.settlement.maxDrawdownPct) }}%</li>
          </ul>
          <div v-if="reveal && !store.display.live" class="reveal">
            <h3>答案揭曉</h3>
            <p><b>{{ reveal.symbol }}</b>　{{ reveal.date }}</p>
            <p class="dim small">開 {{ fmt(reveal.open, 0) }} → 收 {{ fmt(reveal.close, 0) }}（高 {{ fmt(reveal.high, 0) }} / 低 {{ fmt(reveal.low, 0) }}）</p>
            <p v-if="reveal.synthetic" class="dim small">※ 這是開發用的合成資料，並非真實行情。</p>
          </div>
          <div class="row">
            <button class="primary" @click="store.start('random')">再來一局</button>
            <button @click="store.backToMenu()">回選單</button>
          </div>
        </div>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.app { max-width: 1200px; margin: 0 auto; padding: 16px; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
h1 { font-size: 20px; margin: 0; } h1 span { font-size: 14px; font-weight: 400; }
.tag.alt { background: var(--line); color: var(--dim); }
.tag { background: var(--accent); color: #1a1405; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin-bottom: 12px; }
.menu { max-width: 520px; margin: 60px auto; line-height: 1.7; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
.row > button.buy, .row > button.sell { flex: 1; }
.play { display: grid; grid-template-columns: 1fr 300px; gap: 12px; }
.chartbox { height: 560px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.stats > div { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 0; }
.stats b { font-variant-numeric: tabular-nums; }
.bar { height: 4px; background: var(--line); border-radius: 2px; margin-top: 8px; padding: 0 !important; }
.bar i { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
.result h2 { margin: 0 0 8px; font-size: 18px; } .result ul { padding-left: 18px; margin: 0 0 8px; line-height: 1.8; }
.reveal { border-top: 1px solid var(--line); margin-top: 8px; padding-top: 8px; } .reveal h3 { margin: 0 0 4px; font-size: 14px; }
.reveal p { margin: 2px 0; } .small { font-size: 12px; }
@media (max-width: 860px) { .play { grid-template-columns: 1fr; } .chartbox { height: 380px; } }
</style>
