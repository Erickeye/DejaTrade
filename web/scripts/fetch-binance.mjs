// 從 Binance 公開資料（data.binance.vision）抓 1 分鐘 K 線，正規化後輸出成遊戲讀取的 JSON。
// 零外部依賴（Node 18+）。用法：
//   npm run fetch:binance
//   npm run fetch:binance -- --from 2025-01-01 --to 2026-09-30 --per 15 --symbols BTCUSDT,ETHUSDT,SOLUSDT
// 注意：公開散布前請先確認 Binance 資料使用條款（見 PROJECT_BRIEF 4.2）。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const BASE = 'https://data.binance.vision/data/spot/daily/klines'
const MIN_CANDLES = 1380 // 一天 1440 根，缺漏超過約 4% 就不要
const MIN_RANGE_PCT = 0.8 // 當日振幅（高低差 / 開盤）至少 0.8%，避免死魚盤

/** 從單檔 zip 取出第一個檔案內容（用中央目錄，避免 data descriptor 問題） */
export function unzipFirst(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('zip 中央目錄損毀')
  const method = buf.readUInt16LE(cdOffset + 10)
  const compSize = buf.readUInt32LE(cdOffset + 20)
  const localOffset = buf.readUInt32LE(cdOffset + 42)
  const nameLen = buf.readUInt16LE(localOffset + 26)
  const extraLen = buf.readUInt16LE(localOffset + 28)
  const start = localOffset + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + compSize)
  return method === 0 ? data : inflateRawSync(data)
}

/** 解析 Binance K 線 CSV。時間戳 2025 起現貨改用微秒，這裡自動判斷。 */
export function parseKlines(csv) {
  const rows = []
  for (const line of csv.split(/\r?\n/)) {
    if (!line) continue
    const f = line.split(',')
    let t = Number(f[0])
    if (!Number.isFinite(t)) continue // 標題列
    if (t > 1e14) t = Math.floor(t / 1000) // 微秒 → 毫秒
    rows.push({ t, o: +f[1], h: +f[2], l: +f[3], c: +f[4], v: +f[5] })
  }
  rows.sort((a, b) => a.t - b.t)
  return rows
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d

/** 品質篩選 + 正規化；不合格回傳 null */
export function buildDay(rows, dateStr) {
  const dayStart = Date.parse(dateStr + 'T00:00:00Z')
  const r = rows.filter((x) => x.t >= dayStart && x.t < dayStart + 86400000)
  if (r.length < MIN_CANDLES) return null
  const hi = Math.max(...r.map((x) => x.h)), lo = Math.min(...r.map((x) => x.l))
  if (((hi - lo) / r[0].o) * 100 < MIN_RANGE_PCT) return null
  if (r.reduce((s, x) => s + x.v, 0) <= 0) return null
  const scale = r[0].o
  const k = 100 / scale
  return {
    scale,
    candles: r.map((x) => [(x.t - dayStart) / 1000, round(x.o * k, 4), round(x.h * k, 4), round(x.l * k, 4), round(x.c * k, 4), round(x.v, 2)]),
  }
}

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

async function download(symbol, dateStr) {
  const url = `${BASE}/${symbol}/1m/${symbol}-1m-${dateStr}.zip`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url)
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      if (attempt === 2) throw new Error(`${url} 下載失敗：${e.message}`)
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
  )
  const symbols = (args.symbols ?? 'BTCUSDT,ETHUSDT,SOLUSDT').split(',')
  const per = Number(args.per ?? 20)
  const from = Date.parse((args.from ?? '2025-01-01') + 'T00:00:00Z')
  const to = Date.parse((args.to ?? '2026-09-30') + 'T00:00:00Z')
  const days = Math.floor((to - from) / 86400000) + 1
  if (!(days > 0)) throw new Error('日期區間不正確')

  const OUT = new URL('../public/data/', import.meta.url)
  rmSync(new URL('days/', OUT), { recursive: true, force: true })
  mkdirSync(new URL('days/crypto/', OUT), { recursive: true })

  const index = { version: 1, days: [] }
  const rand = rng(20261002)
  let n = 0
  for (const symbol of symbols) {
    // 從區間內隨機抽日期（不重複），失敗或不合格就換下一個
    const order = Array.from({ length: days }, (_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]]
    }
    let got = 0, tried = 0
    for (const off of order) {
      if (got >= per) break
      const dateStr = new Date(from + off * 86400000).toISOString().slice(0, 10)
      tried++
      const zip = await download(symbol, dateStr)
      if (!zip) continue
      const day = buildDay(parseKlines(unzipFirst(zip).toString('utf8')), dateStr)
      if (!day) continue
      n++; got++
      const id = `crypto-${String(n).padStart(4, '0')}`
      const file = `days/crypto/${id}.json`
      writeFileSync(new URL(file, OUT), JSON.stringify({ id, asset: 'crypto', interval: '1m', meta: { symbol, date: dateStr, scale: day.scale }, candles: day.candles }))
      index.days.push({ id, asset: 'crypto', symbol, file })
      process.stdout.write(`\r${symbol} ${got}/${per}（已嘗試 ${tried} 天）`)
    }
    process.stdout.write('\n')
    if (got < per) console.warn(`警告：${symbol} 只湊到 ${got} 天，請放寬日期區間`)
  }
  // 打散順序，讓索引不洩漏標的分組
  for (let i = index.days.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [index.days[i], index.days[j]] = [index.days[j], index.days[i]]
  }
  writeFileSync(new URL('index.json', OUT), JSON.stringify(index, null, 1))
  console.log(`完成：${index.days.length} 個交易日 → public/data/`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1) })
