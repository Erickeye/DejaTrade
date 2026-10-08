import type { FillReason, Trade } from './types'

/** 一次完整的來回交易：從空手開倉 → 回到空手（反手會拆成兩筆） */
export interface RoundTrip {
  side: 'long' | 'short'
  entryCandle: number
  exitCandle: number
  /** 最大持倉數量（含加碼） */
  qty: number
  /** 平均進場價 / 平均出場價（引擎正規化價格） */
  entryPrice: number
  exitPrice: number
  /** 扣除手續費後的損益（USD） */
  pnl: number
  fees: number
  /** 最後一筆平倉的原因（止盈 / 止損 / 強平 / 市價…） */
  exitReason: FillReason
}

/** 由成交紀錄還原來回交易。 */
export function roundTrips(trades: Trade[]): RoundTrip[] {
  const out: RoundTrip[] = []
  let pos = 0
  let cur: { side: 'long' | 'short'; entryCandle: number; entryQty: number; entryValue: number; exitQty: number; exitValue: number; maxQty: number; realized: number; fees: number } | null = null

  for (const t of trades) {
    const dir = t.side === 'buy' ? 1 : -1
    let remaining = t.qty
    const feePerUnit = t.qty > 0 ? t.fee / t.qty : 0
    while (remaining > 1e-12) {
      if (pos === 0 || Math.sign(pos) === dir) {
        // 開倉 / 加碼
        if (!cur) cur = { side: dir > 0 ? 'long' : 'short', entryCandle: t.candleIndex, entryQty: 0, entryValue: 0, exitQty: 0, exitValue: 0, maxQty: 0, realized: 0, fees: 0 }
        cur.entryQty += remaining
        cur.entryValue += remaining * t.price
        cur.fees += remaining * feePerUnit
        pos += dir * remaining
        cur.maxQty = Math.max(cur.maxQty, Math.abs(pos))
        remaining = 0
      } else {
        // 減倉 / 平倉（超出的部分繼續迴圈 → 反手開新倉）
        const closeQty = Math.min(remaining, Math.abs(pos))
        cur!.exitQty += closeQty
        cur!.exitValue += closeQty * t.price
        cur!.realized += t.realized // 引擎的 realized 只含被平掉的那一部分，整筆都屬於這次平倉
        cur!.fees += closeQty * feePerUnit
        pos += dir * closeQty
        remaining -= closeQty
        if (Math.abs(pos) < 1e-12) {
          pos = 0
          const c = cur!
          out.push({
            side: c.side,
            entryCandle: c.entryCandle,
            exitCandle: t.candleIndex,
            qty: c.maxQty,
            entryPrice: c.entryValue / c.entryQty,
            exitPrice: c.exitValue / c.exitQty,
            pnl: c.realized - c.fees,
            fees: c.fees,
            exitReason: t.reason,
          })
          cur = null
        }
      }
    }
  }
  return out
}

export interface TradeStats {
  count: number
  wins: number
  losses: number
  /** 0–1；沒有交易為 null */
  winRate: number | null
  avgWin: number
  avgLoss: number
  /** 平均盈 / 平均虧（盈虧比）；沒有虧損為 null */
  payoff: number | null
  /** 總獲利 / 總虧損；沒有虧損為 null */
  profitFactor: number | null
  best: number
  worst: number
  /** 平均持倉（K 線根數） */
  avgHold: number
  grossProfit: number
  grossLoss: number
}

export function tradeStats(trips: RoundTrip[]): TradeStats {
  const wins = trips.filter((t) => t.pnl > 0)
  const losses = trips.filter((t) => t.pnl < 0)
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = -losses.reduce((s, t) => s + t.pnl, 0)
  const avgWin = wins.length ? grossProfit / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  return {
    count: trips.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trips.length ? wins.length / trips.length : null,
    avgWin,
    avgLoss,
    payoff: avgLoss > 0 ? avgWin / avgLoss : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    best: trips.length ? Math.max(...trips.map((t) => t.pnl)) : 0,
    worst: trips.length ? Math.min(...trips.map((t) => t.pnl)) : 0,
    avgHold: trips.length ? trips.reduce((s, t) => s + (t.exitCandle - t.entryCandle), 0) / trips.length : 0,
    grossProfit,
    grossLoss,
  }
}
