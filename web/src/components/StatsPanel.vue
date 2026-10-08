<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GameRecord, Summary } from '../storage/records'

const props = defineProps<{ summary: Summary; history: GameRecord[]; persistent: boolean }>()
const emit = defineEmits<{ clear: [] }>()

const fmt = (n: number, d = 2) => n.toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d })
const signed = (n: number, d = 2) => (n > 0 ? '+' : '') + fmt(n, d)
const cls = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'dim')
const recent = computed(() => [...props.history].reverse().slice(0, 8))
const label = (r: GameRecord) => (r.blind ? '盲測' : r.symbol.replace(/USDT$/, '')) + (r.daily ? ' · 每日' : '')
const confirming = ref(false)
function clear() {
  if (!confirming.value) { confirming.value = true; setTimeout(() => (confirming.value = false), 3000); return }
  confirming.value = false
  emit('clear')
}
</script>

<template>
  <div v-if="summary.games > 0" class="stats-panel">
    <div class="head">
      <b>我的戰績</b>
      <span v-if="summary.dailyStreak > 0" class="streak">每日挑戰連續 {{ summary.dailyStreak }} 天</span>
    </div>
    <div class="grid">
      <div><span class="dim">總局數</span><b>{{ summary.games }}</b></div>
      <div><span class="dim">獲利局</span><b>{{ summary.winRate == null ? '—' : (summary.winRate * 100).toFixed(0) + '%' }}</b></div>
      <div><span class="dim">累計損益</span><b :class="cls(summary.totalPnl)">{{ signed(summary.totalPnl, 0) }}</b></div>
      <div><span class="dim">平均每局</span><b :class="cls(summary.avgPnlPct)">{{ signed(summary.avgPnlPct) }}%</b></div>
      <div><span class="dim">最佳</span><b class="up">{{ summary.best ? signed(summary.best.pnlPct) + '%' : '—' }}</b></div>
      <div><span class="dim">爆倉</span><b :class="summary.liquidations ? 'down' : ''">{{ summary.liquidations }} 次</b></div>
    </div>
    <div class="recent">
      <div v-for="r in recent" :key="r.id" class="line">
        <span class="dim">{{ label(r) }}</span>
        <span :class="cls(r.pnl)">{{ signed(r.pnlPct) }}%</span>
      </div>
    </div>
    <div class="foot">
      <span class="dim small">{{ persistent ? '戰績存在這個瀏覽器裡，清除網站資料會一併消失。' : '此瀏覽器無法儲存，關閉分頁後戰績會消失。' }}</span>
      <button class="mini" @click="clear">{{ confirming ? '再按一次確認清除' : '清除戰績' }}</button>
    </div>
  </div>
</template>

<style scoped>
.stats-panel { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 12px; }
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.streak { background: var(--accent); color: #1a1405; border-radius: 999px; padding: 1px 10px; font-size: 12px; font-weight: 600; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
.grid > div, .line { display: flex; justify-content: space-between; font-size: 13px; font-variant-numeric: tabular-nums; }
.recent { margin-top: 10px; border-top: 1px dashed var(--line); padding-top: 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 10px; }
button.mini { padding: 1px 8px; font-size: 12px; white-space: nowrap; }
.small { font-size: 12px; }
</style>
