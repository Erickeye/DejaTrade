// 從 Dukascopy 抓外匯 1 分鐘 K 線（買價），正規化後輸出成遊戲讀取的 JSON，格式與加密貨幣相同。
// 需要先 npm install（使用 dukascopy-node）。用法：
//   npm run fetch:fx
//   npm run fetch:fx -- --from 2025-01-01 --to 2026-09-30 --per 10 --symbols EURUSD,GBPUSD,USDJPY
//
// 注意：Dukascopy 網站條款限制為「個人、非商業」使用，且不得再散布或用來建立資料庫。
// 本專案僅供個人練習：產出的 public/data/ 不進版控、不公開部署。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { buildDay, readIndex, rng } from './fetch-binance.mjs'
import { fileURLToPath } from 'node:url'

/** 貨幣對設定。spreadPips 為遊戲內模擬用的固定點差（K 線資料沒有買賣價差）。 */
export const PAIRS = {
  EURUSD: { instrument: 'eurusd', pipSize: 0.0001, digits: 5, spreadPips: 0.5, usdIsQuote: true },
  GBPUSD: { instrument: 'gbpusd', pipSize: 0.0001, digits: 5, spreadPips: 0.8, usdIsQuote: true },
  USDJPY: { instrument: 'usdjpy', pipSize: 0.01, digits: 3, spreadPips: 0.6, usdIsQuote: false },
}

// 外匯品質門檻：一天要有 96% 以上的分鐘、振幅至少 0.25%；外匯沒有集中成交量，所以不檢查成交量
const QUALITY = { minCandles: 1380, minRangePct: 0.25, requireVolume: false }

/**
 * 在區間內抽出可用的日期（依 weekdays 過濾，1 = 週一 … 5 = 週五），順序隨機。
 * 預設只用週一到週四：週五 UTC 晚間市場已收盤，K 線會不完整。
 */
export function candidateDates(from, to, weekdays, rand) {
  const out = []
  for (let t = from; t <= to; t += 86400000) {
    if (weekdays.includes(new Date(t).getUTCDay())) out.push(new Date(t).toISOString().slice(0, 10))
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

async function main() {
  let getHistoricalRates
  try {
    ;({ getHistoricalRates } = await import('dukascopy-node'))
  } catch {
    throw new Error('找不到 dukascopy-node，請先在 web 資料夾執行 npm install')
  }
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
  )
  const symbols = (args.symbols ?? 'EURUSD,GBPUSD,USDJPY').split(',')
  for (const s of symbols) if (!PAIRS[s]) throw new Error(`不支援的貨幣對：${s}（可用：${Object.keys(PAIRS).join(', ')}）`)
  const per = Number(args.per ?? 10)
  const from = Date.parse((args.from ?? '2025-01-01') + 'T00:00:00Z')
  const to = Date.parse((args.to ?? '2026-09-30') + 'T00:00:00Z')
  const weekdays = (args.weekdays ?? '1,2,3,4').split(',').map(Number)
  if (!(to >= from)) throw new Error('日期區間不正確')

  const OUT = new URL('../public/data/', import.meta.url)
  rmSync(new URL('days/fx/', OUT), { recursive: true, force: true })
  mkdirSync(new URL('days/fx/', OUT), { recursive: true })
  const index = { version: 1, days: readIndex(OUT).filter((d) => d.asset !== 'fx') }
  const keep = index.days.length

  const rand = rng(20261005)
  let n = 0
  for (const symbol of symbols) {
    const cfg = PAIRS[symbol]
    let got = 0, tried = 0
    for (const dateStr of candidateDates(from, to, weekdays, rand)) {
      if (got >= per) break
      tried++
      const start = new Date(dateStr + 'T00:00:00Z')
      let raw
      try {
        raw = await getHistoricalRates({
          instrument: cfg.instrument,
          dates: { from: start, to: new Date(start.getTime() + 86400000) },
          timeframe: 'm1',
          priceType: 'bid',
          format: 'json',
          volumes: true,
          ignoreFlats: false,
          useCache: true,
          cacheFolderPath: '.dukascopy-cache',
          batchSize: 6,
          pauseBetweenBatchesMs: 500,
          retryCount: 3,
        })
      } catch (e) {
        console.warn(`\n${symbol} ${dateStr} 下載失敗：${e.message}`)
        continue
      }
      const rows = raw.map((r) => ({ t: r.timestamp, o: r.open, h: r.high, l: r.low, c: r.close, v: r.volume ?? 0 }))
      const day = buildDay(rows, dateStr, QUALITY)
      if (!day) continue
      n++; got++
      const id = `fx-${String(n).padStart(4, '0')}`
      const file = `days/fx/${id}.json`
      const meta = { symbol, date: dateStr, scale: day.scale, pipSize: cfg.pipSize, digits: cfg.digits, spreadPips: cfg.spreadPips, usdIsQuote: cfg.usdIsQuote }
      writeFileSync(new URL(file, OUT), JSON.stringify({ id, asset: 'fx', interval: '1m', meta, candles: day.candles }))
      index.days.push({ id, asset: 'fx', symbol, file })
      process.stdout.write(`\r${symbol} ${got}/${per}（已嘗試 ${tried} 天）`)
    }
    process.stdout.write('\n')
    if (got < per) console.warn(`警告：${symbol} 只湊到 ${got} 天，請放寬日期區間或加上 --weekdays 1,2,3,4,5`)
  }
  for (let i = index.days.length - 1; i > keep; i--) {
    const j = keep + Math.floor(rand() * (i - keep + 1));
    ;[index.days[i], index.days[j]] = [index.days[j], index.days[i]]
  }
  writeFileSync(new URL('index.json', OUT), JSON.stringify(index, null, 1))
  console.log(`完成：${n} 個外匯交易日 → public/data/`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1) })
