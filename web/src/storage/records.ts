// 戰績存檔：每局結算後存一筆。優先用 IndexedDB，無法使用（私密視窗、被停用）時退回記憶體，
// 此時戰績只在本次分頁有效。所有統計函式都是純函式，方便測試。

export interface GameRecord {
  id: string
  /** 結算時間（ms） */
  ts: number
  daily: boolean
  /** 每日挑戰的日期（UTC，YYYY-MM-DD） */
  dailyDate?: string
  blind: boolean
  asset: string
  symbol: string
  /** 該局行情的日期 */
  date: string
  synthetic: boolean
  leverage: number
  pnl: number
  pnlPct: number
  trades: number
  /** 來回交易勝率 0–1；沒有交易為 null */
  winRate: number | null
  maxDrawdownPct: number
  liquidated: boolean
}

export interface Summary {
  games: number
  /** 獲利局數 */
  winGames: number
  /** 獲利局比例 0–1；沒有紀錄為 null */
  winRate: number | null
  totalPnl: number
  avgPnlPct: number
  best: GameRecord | null
  worst: GameRecord | null
  liquidations: number
  dailyStreak: number
  bestDailyStreak: number
}

const DAY = 86_400_000
const dayNum = (d: string) => Math.floor(Date.parse(d + 'T00:00:00Z') / DAY)

/** 連續完成每日挑戰的天數：今天或昨天有完成才算還在連勝中。 */
export function dailyStreak(dates: string[], today: string): number {
  const set = new Set(dates.map(dayNum))
  let d = dayNum(today)
  if (!set.has(d)) d-- // 今天還沒玩不中斷連勝
  let n = 0
  while (set.has(d)) { n++; d-- }
  return n
}

export function bestStreak(dates: string[]): number {
  const days = [...new Set(dates.map(dayNum))].sort((a, b) => a - b)
  let best = 0, run = 0, prev = NaN
  for (const d of days) {
    run = d === prev + 1 ? run + 1 : 1
    prev = d
    best = Math.max(best, run)
  }
  return best
}

/** 每日挑戰只有「當天第一次」的成績算數 */
export function dailyRecord(records: GameRecord[], date: string): GameRecord | undefined {
  return records.filter((r) => r.daily && r.dailyDate === date).sort((a, b) => a.ts - b.ts)[0]
}

export function summarize(records: GameRecord[], today: string): Summary {
  const dailyDates = records.filter((r) => r.daily && r.dailyDate).map((r) => r.dailyDate!)
  const byPnl = [...records].sort((a, b) => b.pnlPct - a.pnlPct)
  const wins = records.filter((r) => r.pnl > 0).length
  return {
    games: records.length,
    winGames: wins,
    winRate: records.length ? wins / records.length : null,
    totalPnl: records.reduce((s, r) => s + r.pnl, 0),
    avgPnlPct: records.length ? records.reduce((s, r) => s + r.pnlPct, 0) / records.length : 0,
    best: byPnl[0] ?? null,
    worst: byPnl.length > 1 ? byPnl.at(-1)! : null,
    liquidations: records.filter((r) => r.liquidated).length,
    dailyStreak: dailyStreak(dailyDates, today),
    bestDailyStreak: bestStreak(dailyDates),
  }
}

// ───────────── 儲存層 ─────────────

export interface RecordStore {
  readonly persistent: boolean
  all(): Promise<GameRecord[]>
  add(r: GameRecord): Promise<void>
  clear(): Promise<void>
}

const MAX_RECORDS = 500

export function memoryStore(): RecordStore {
  let list: GameRecord[] = []
  return {
    persistent: false,
    async all() { return [...list] },
    async add(r) { list = [...list, r].slice(-MAX_RECORDS) },
    async clear() { list = [] },
  }
}

const DB_NAME = 'dejatrade'
const STORE = 'games'

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
}

/** 開啟 IndexedDB；任何環節失敗都退回記憶體版 */
export async function openRecordStore(): Promise<RecordStore> {
  try {
    if (typeof indexedDB === 'undefined') return memoryStore()
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const open = indexedDB.open(DB_NAME, 1)
      open.onupgradeneeded = () => { open.result.createObjectStore(STORE, { keyPath: 'id' }) }
      open.onsuccess = () => res(open.result)
      open.onerror = () => rej(open.error)
      open.onblocked = () => rej(new Error('blocked'))
    })
    const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE)
    return {
      persistent: true,
      async all() {
        const rows = (await reqP(tx('readonly').getAll())) as GameRecord[]
        return rows.sort((a, b) => a.ts - b.ts)
      },
      async add(r) {
        await reqP(tx('readwrite').put(r))
        // 超過上限時刪最舊的
        const rows = (await reqP(tx('readonly').getAll())) as GameRecord[]
        if (rows.length > MAX_RECORDS) {
          const old = rows.sort((a, b) => a.ts - b.ts).slice(0, rows.length - MAX_RECORDS)
          const store = tx('readwrite')
          await Promise.all(old.map((o) => reqP(store.delete(o.id))))
        }
      },
      async clear() { await reqP(tx('readwrite').clear()) },
    }
  } catch {
    return memoryStore()
  }
}

// ───────────── 輕量偏好設定（localStorage，失敗就忽略） ─────────────

export function getPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem('dejatrade:' + key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export function setPref(key: string, value: unknown): void {
  try { localStorage.setItem('dejatrade:' + key, JSON.stringify(value)) } catch { /* 私密模式等情況：略過 */ }
}
