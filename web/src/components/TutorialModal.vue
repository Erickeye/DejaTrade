<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ isFx: boolean }>()
const emit = defineEmits<{ close: [] }>()
const step = ref(0)

const slides = [
  { title: '這是什麼？', body: ['隨機抽出「歷史上真實的某一天」，一根一根 K 線播放給你看，你要決定何時進場、何時出場。', '「實況」模式會顯示日期與真實價格；「盲測」會隱藏標的與日期，結算後才揭曉，用來練習不被記憶影響的判讀。'] },
  { title: '看盤與時間', body: ['1x 是真實時間：1 分鐘 K 線要跑 60 秒。想快一點可以按 5x ~ 300x，隨時可以暫停。', '上方可切換 1m / 5m / 15m / 1h，並開關均線、布林通道、RSI、MACD 等指標。'] },
  { title: '下單', body: ['「買進 / 做多」＝預期會漲；「賣出 / 做空」＝預期會跌，兩邊賺法對稱。', '市價：馬上成交。限價：等價格到你指定的位置才成交。停損單：價格突破某處才進場。', '下單卡下方的「風險預覽」會告訴你：要多少保證金、止損被打到會虧多少。'] },
  { title: '止盈與止損', body: ['進場前就決定好「賺到哪裡收、賠到哪裡認」：在止盈價 / 止損價欄位輸入價格，或進場後直接在圖上拖曳虛線。', '新手最重要的一件事：每一筆都設止損。「追蹤 %」則會讓止損跟著獲利往上移，鎖住利潤。'] },
  { title: '槓桿與強平', body: ['槓桿讓你用小本金開大部位：本金 10,000、30 倍槓桿，最多能持有 300,000 的名目部位。', '虧損也同樣被放大。淨值掉到保證金的一半，系統會強制平倉（爆倉），圖上黃色線「強平價」就是這個位置。'] },
  ...[{ title: '外匯：pip 與手數', body: ['pip 是最小報價單位：EUR/USD 的 0.0001、USD/JPY 的 0.01。', '1 手 = 100,000 基礎貨幣。1 手 EUR/USD 每跳 1 pip 約 $10；0.1 手約 $1。', '外匯沒有手續費，成本在「點差」：一進場就先虧掉點差。'] }],
  { title: '結算與復盤', body: ['按「結算本局」會平掉所有部位並顯示成績。', '復盤會畫出淨值曲線、勝率、盈虧比，並列出每筆交易的進出場與出場原因，幫你找出問題。', '你的戰績會記在這個瀏覽器，每天一局「今日挑戰」可累積連續天數。'] },
]
const last = slides.length - 1
</script>

<template>
  <div class="overlay" role="dialog" aria-modal="true" aria-label="新手教學" @click.self="emit('close')">
    <div class="modal">
      <div class="dots"><i v-for="(_, i) in slides" :key="i" :class="{ on: i === step }"></i></div>
      <h2>{{ slides[step]!.title }}</h2>
      <p v-for="(t, i) in slides[step]!.body" :key="i">{{ t }}</p>
      <p v-if="isFx && step === 5" class="dim small">你現在玩的是外匯，這頁的數字可以直接套用。</p>
      <div class="row">
        <button :disabled="step === 0" @click="step--">上一步</button>
        <span class="grow"></span>
        <button @click="emit('close')">略過</button>
        <button v-if="step < last" class="primary" @click="step++">下一步</button>
        <button v-else class="primary" @click="emit('close')">開始玩</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .6); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
.modal { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px; width: 100%; max-width: 460px; line-height: 1.7; }
h2 { margin: 6px 0 10px; font-size: 18px; }
p { margin: 6px 0; font-size: 14px; }
.row { display: flex; gap: 8px; align-items: center; margin-top: 18px; }
.grow { flex: 1; }
.dots { display: flex; gap: 6px; } .dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--line); }
.dots i.on { background: var(--accent); }
.small { font-size: 12px; }
</style>
