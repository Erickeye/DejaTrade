// 掃描 public/data/days 內每個單日檔，依 meta 重建 index.json（補上 symbol / synthetic 欄位）。
// 不需重新下載資料。用法：node scripts/reindex.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const OUT = new URL('../public/data/', import.meta.url)
const index = { version: 1, days: [] }
for (const asset of readdirSync(new URL('days/', OUT))) {
  for (const f of readdirSync(new URL(`days/${asset}/`, OUT)).filter((x) => x.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(new URL(`days/${asset}/${f}`, OUT), 'utf8'))
    index.days.push({ id: d.id, asset: d.asset, symbol: d.meta.symbol, synthetic: d.meta.synthetic || undefined, file: `days/${asset}/${f}` })
  }
}
// 打散順序，避免索引順序洩漏分組
let s = 12345
const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
for (let i = index.days.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [index.days[i], index.days[j]] = [index.days[j], index.days[i]] }
writeFileSync(new URL('index.json', OUT), JSON.stringify(index, null, 1))
console.log(`已重建索引：${index.days.length} 局`)
