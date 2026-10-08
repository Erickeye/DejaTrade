<script setup lang="ts">
import { computed } from 'vue'

/** 淨值曲線（純 SVG）：虛線 = 起始資金；圓點 = 每筆來回交易的出場（綠賺紅賠） */
const props = defineProps<{ values: number[]; exits: { index: number; pnl: number }[] }>()

const W = 300, H = 110, PAD = 6
const geo = computed(() => {
  const v = props.values
  if (v.length < 2) return null
  const lo = Math.min(...v), hi = Math.max(...v)
  const span = hi - lo || 1
  const x = (i: number) => PAD + (i / (v.length - 1)) * (W - PAD * 2)
  const y = (n: number) => H - PAD - ((n - lo) / span) * (H - PAD * 2)
  const pts = v.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ')
  const up = v[v.length - 1]! >= v[0]!
  return { pts, base: y(v[0]!), up, dots: props.exits.filter((e) => e.index < v.length).map((e) => ({ cx: x(e.index), cy: y(v[e.index]!), win: e.pnl > 0 })) }
})
</script>

<template>
  <svg v-if="geo" class="eq" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" aria-label="淨值曲線">
    <line :x1="PAD" :x2="W - PAD" :y1="geo.base" :y2="geo.base" class="base" />
    <polyline :points="geo.pts" fill="none" :class="geo.up ? 'line up' : 'line down'" vector-effect="non-scaling-stroke" />
    <circle v-for="(d, i) in geo.dots" :key="i" :cx="d.cx" :cy="d.cy" r="3" :class="d.win ? 'dot up' : 'dot down'" />
  </svg>
</template>

<style scoped>
.eq { width: 100%; height: 110px; display: block; background: var(--bg); border-radius: 8px; }
.base { stroke: var(--dim); stroke-width: 1; stroke-dasharray: 3 3; opacity: .6; }
.line { stroke-width: 2; } .line.up { stroke: var(--up); } .line.down { stroke: var(--down); }
.dot.up { fill: var(--up); } .dot.down { fill: var(--down); }
</style>
