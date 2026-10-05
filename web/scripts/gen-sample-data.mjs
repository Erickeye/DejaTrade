// 產生「合成」樣本資料，僅供雛型開發使用（真實資料將由 C# DejaTrade.DataTool 匯出，格式相同）。
// 用法：npm run gen:sample
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'

const OUT = new URL('../public/data/', import.meta.url)
const DAYS = 24
const N = 1440

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d

rmSync(new URL('days/', OUT), { recursive: true, force: true })
mkdirSync(new URL('days/crypto/', OUT), { recursive: true })

const index = { version: 1, days: [] }
for (let d = 0; d < DAYS; d++) {
  const r = rng(1000 + d * 7919)
  const drift = (r() - 0.5) * 0.00008 // 每分鐘趨勢，各日不同
  let vol = 0.0006 + r() * 0.0010 // 基礎波動
  let p = 100
  const candles = []
  for (let i = 0; i < N; i++) {
    // 波動度叢集 + 偶爾出現的大波動
    vol = Math.max(0.0003, Math.min(0.004, vol * (1 + (r() - 0.5) * 0.06)))
    const shock = r() < 0.004 ? gauss(r) * vol * 6 : 0
    const o = p
    let path = o
    let h = o, l = o
    const steps = 6
    for (let s = 0; s < steps; s++) {
      path *= 1 + drift / steps + (gauss(r) * vol) / Math.sqrt(steps) + shock / steps
      h = Math.max(h, path); l = Math.min(l, path)
    }
    const c = path
    p = c
    candles.push([i * 60, round(o), round(h), round(l), round(c), round(5 + r() * 40 * (1 + Math.abs(c / o - 1) * 400), 2)])
  }
  const id = `crypto-${String(d + 1).padStart(4, '0')}`
  const day = {
    id, asset: 'crypto', interval: '1m',
    meta: { symbol: 'SYNTH-' + String.fromCharCode(65 + (d % 26)), date: `2099-01-${String(d + 1).padStart(2, '0')}`, scale: round(20000 + r() * 60000, 2), synthetic: true },
    candles,
  }
  writeFileSync(new URL(`days/crypto/${id}.json`, OUT), JSON.stringify(day))
  index.days.push({ id, asset: 'crypto', symbol: day.meta.symbol, synthetic: true, file: `days/crypto/${id}.json` })
}

// 外匯合成資料（供沒有真實資料時測試外匯介面；格式與 fetch:fx 相同）
mkdirSync(new URL('days/fx/', OUT), { recursive: true })
const FX = [
  { symbol: 'EURUSD', scale: 1.0842, pipSize: 0.0001, digits: 5, spreadPips: 0.5, usdIsQuote: true },
  { symbol: 'GBPUSD', scale: 1.2731, pipSize: 0.0001, digits: 5, spreadPips: 0.8, usdIsQuote: true },
  { symbol: 'USDJPY', scale: 150.215, pipSize: 0.01, digits: 3, spreadPips: 0.6, usdIsQuote: false },
]
let fxn = 0
for (const cfg of FX) {
  for (let d = 0; d < 2; d++) {
    const r = rng(7000 + fxn * 131)
    let p = 100, vol = 0.00007 + r() * 0.00005
    const candles = []
    for (let i = 0; i < N; i++) {
      vol = Math.max(0.00003, Math.min(0.0004, vol * (1 + (r() - 0.5) * 0.08)))
      const o = p; let h = o, l = o, path = o
      for (let s = 0; s < 6; s++) { path *= 1 + gauss(r) * vol / Math.sqrt(6); h = Math.max(h, path); l = Math.min(l, path) }
      p = path
      candles.push([i * 60, round(o, 4), round(h, 4), round(l, 4), round(path, 4), round(20 + r() * 80, 2)])
    }
    fxn++
    const id = `fx-${String(fxn).padStart(4, '0')}`
    const meta = { symbol: cfg.symbol, date: `2099-02-${String(fxn).padStart(2, '0')}`, scale: cfg.scale, pipSize: cfg.pipSize, digits: cfg.digits, spreadPips: cfg.spreadPips, usdIsQuote: cfg.usdIsQuote, synthetic: true }
    writeFileSync(new URL(`days/fx/${id}.json`, OUT), JSON.stringify({ id, asset: 'fx', interval: '1m', meta, candles }))
    index.days.push({ id, asset: 'fx', symbol: cfg.symbol, synthetic: true, file: `days/fx/${id}.json` })
  }
}
writeFileSync(new URL('index.json', OUT), JSON.stringify(index, null, 1))
console.log(`已產生 ${DAYS} 個合成交易日 → public/data/`)
