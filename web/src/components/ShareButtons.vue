<script setup lang="ts">
import { ref } from 'vue'
import { canvasToBlob, drawShareCard, type ShareData } from '../share/card'

const props = defineProps<{ data: ShareData }>()
const msg = ref('')
const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write

async function render(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  drawShareCard(canvas, props.data)
  return canvasToBlob(canvas)
}
function say(t: string) { msg.value = t; setTimeout(() => (msg.value = ''), 2500) }

async function download() {
  try {
    const url = URL.createObjectURL(await render())
    const a = document.createElement('a')
    a.href = url
    a.download = `dejatrade-${new Date().toISOString().slice(0, 10)}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch { say('產生圖片失敗') }
}
async function copy() {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': render() })])
    say('已複製，可直接貼上')
  } catch { say('瀏覽器不允許複製，請改用下載') }
}
</script>

<template>
  <div class="share">
    <div class="row">
      <button @click="download">下載成績圖</button>
      <button v-if="canCopy" @click="copy">複製圖片</button>
      <span v-if="msg" class="dim small">{{ msg }}</span>
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
.small { font-size: 12px; }
</style>
