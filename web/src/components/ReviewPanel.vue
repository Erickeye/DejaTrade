<script setup lang="ts">
import { computed } from 'vue'
import type { RoundTrip, TradeStats } from '../engine'
import EquityChart from './EquityChart.vue'

const props = defineProps<{
  trips: RoundTrip[]
  stats: TradeStats
  equity: number[]
  /** 引擎正規化價格 → 畫面價格字串 */
  fmtPrice: (norm: number) => string
  sizeText: (qty: number, norm: number) => string
}>()

const REASON: Record<string, string> = { market: '手動平倉', limit: '限價', stop: '停損單', tp: '止盈', sl: '止損', liquidation: '強平' }
const fmt = (n: number, d = 2) => n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d })
const signed = (n: number) => (n > 0 ? '+' : '') + fmt(n)
const cls = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'dim')
const exits = computed(() => props.trips.map((t) => ({ index: t.exitCandle + 1, pnl: t.pnl })))

/** 一句話點評：只依據客觀數字，不給投資建議 */
const comments = computed(() => {
  const s = props.stats, out: string[] = []
  if (s.count === 0) return ['這局沒有完成任何一筆交易。先小量進場，再觀察止盈止損怎麼運作。']
  if (s.wins === 0) {
    out.push('這局的來回交易全部虧損。回頭看看進場點與止損位置，是進得太追、還是止損太近被洗掉。')
  } else if (s.payoff != null && s.winRate != null) {
    const breakeven = 1 / (1 + s.payoff)
    out.push(s.winRate >= breakeven ? `勝率 ${(s.winRate * 100).toFixed(0)}% 高於你的損益兩平點 ${(breakeven * 100).toFixed(0)}%（由盈虧比 ${s.payoff.toFixed(2)} 推得），這樣的交易結構長期是正期望值。` : `勝率 ${(s.winRate * 100).toFixed(0)}% 低於損益兩平點 ${(breakeven * 100).toFixed(0)}%（盈虧比 ${s.payoff.toFixed(2)}），平均每筆是虧的：要嘛提高勝率，要嘛讓賺的比賠的大。`)
  } else if (s.losses === 0) out.push('全部獲利，但樣本很少，不代表交易方法可靠。')
  const sl = props.trips.filter((t) => t.exitReason === 'sl').length
  if (sl === 0 && s.losses > 0) out.push('虧損的單都沒有觸發止損，是手動砍單或強平。事先設好止損能讓風險更可控。')
  if (props.trips.some((t) => t.exitReason === 'liquidation')) out.push('發生過強制平倉：槓桿太高或部位太大，請降低手數或槓桿。')
  if (s.avgHold < 3 && s.count >= 5) out.push('平均持倉很短、交易很頻繁，成本（點差與手續費）會吃掉不少利潤。')
  return out
})
</script>

<template>
  <div class="review">
    <h3>復盤</h3>
    <EquityChart :values="equity" :exits="exits" />
    <div class="dim small">淨值曲線（點 = 每筆平倉，綠賺紅賠）</div>

    <div class="grid">
      <div><span class="dim">來回交易</span><b>{{ stats.count }} 筆</b></div>
      <div><span class="dim">勝率</span><b>{{ stats.winRate == null ? '—' : (stats.winRate * 100).toFixed(0) + '%' }}</b></div>
      <div><span class="dim">平均獲利</span><b class="up">{{ stats.wins ? '+' + fmt(stats.avgWin) : '—' }}</b></div>
      <div><span class="dim">平均虧損</span><b class="down">{{ stats.losses ? '-' + fmt(stats.avgLoss) : '—' }}</b></div>
      <div><span class="dim">盈虧比</span><b>{{ stats.payoff == null ? '—' : stats.payoff.toFixed(2) }}</b></div>
      <div><span class="dim">獲利因子</span><b>{{ stats.profitFactor == null ? '—' : stats.profitFactor.toFixed(2) }}</b></div>
      <div><span class="dim">最佳一筆</span><b :class="cls(stats.best)">{{ stats.count ? signed(stats.best) : '—' }}</b></div>
      <div><span class="dim">最差一筆</span><b :class="cls(stats.worst)">{{ stats.count ? signed(stats.worst) : '—' }}</b></div>
    </div>

    <p v-for="(c, i) in comments" :key="i" class="note small">{{ c }}</p>

    <div v-if="trips.length" class="trips">
      <div class="dim small">交易明細</div>
      <div v-for="(t, i) in trips" :key="i" class="trip">
        <div class="top">
          <span :class="t.side === 'long' ? 'up' : 'down'">{{ t.side === 'long' ? '做多' : '做空' }} {{ sizeText(t.qty, t.entryPrice) }}</span>
          <b :class="cls(t.pnl)">{{ signed(t.pnl) }}</b>
        </div>
        <div class="dim small">{{ fmtPrice(t.entryPrice) }} → {{ fmtPrice(t.exitPrice) }} · {{ REASON[t.exitReason] }} · 持有 {{ t.exitCandle - t.entryCandle }} 根</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.review { border-top: 1px solid var(--line); margin-top: 10px; padding-top: 10px; }
h3 { margin: 0 0 8px; font-size: 14px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin: 10px 0; }
.grid > div { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; }
.grid b { font-variant-numeric: tabular-nums; }
.note { color: var(--text); background: var(--bg); border-left: 3px solid var(--accent); padding: 6px 8px; border-radius: 4px; line-height: 1.5; margin: 6px 0 !important; }
.trips { max-height: 240px; overflow-y: auto; margin-top: 8px; }
.trip { padding: 5px 0; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
.trip .top { display: flex; justify-content: space-between; font-size: 13px; }
.small { font-size: 12px; }
</style>
