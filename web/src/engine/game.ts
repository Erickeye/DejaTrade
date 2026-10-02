import type { Candle, GameOptions, Settlement, Side, Trade } from './types'
import { createRng, type Rng } from './rng'
import { ticksForCandle } from './ticks'

export class OrderError extends Error {}

/**
 * 單局遊戲引擎：播放時鐘 + 帳戶 + 下單 + 結算。
 * 純 TypeScript，不依賴 Vue / DOM。同樣的 candles + seed 會得到完全相同的 tick 序列。
 */
export class Game {
  readonly initialCash: number
  readonly feeRate: number
  readonly leverage: number
  readonly ticksPerCandle: number

  cash: number
  /** 帶正負號的部位數量：>0 多單、<0 空單 */
  qty = 0
  avgEntry = 0
  realized = 0
  totalFees = 0
  trades: Trade[] = []
  liquidated = false

  candleIndex = 0
  private tickIndex = 0
  private currentTicks: number[]
  price: number
  private peakEquity: number
  maxDrawdownPct = 0
  /** 目前這根 K 線「到目前為止」的樣子 */
  current: Candle

  private readonly rng: Rng

  constructor(
    readonly candles: Candle[],
    opts: GameOptions = {},
  ) {
    if (candles.length === 0) throw new Error('candles 不可為空')
    this.initialCash = opts.initialCash ?? 10000
    this.feeRate = opts.feeRate ?? 0.0005
    this.leverage = opts.leverage ?? 1
    this.ticksPerCandle = opts.ticksPerCandle ?? 6
    this.rng = createRng(opts.seed ?? 1)
    this.cash = this.initialCash
    this.peakEquity = this.initialCash
    const first = candles[0]!
    this.price = first.o
    this.currentTicks = ticksForCandle(first, this.ticksPerCandle, this.rng)
    this.current = { t: first.t, o: first.o, h: first.o, l: first.o, c: first.o, v: 0 }
  }

  get finished(): boolean {
    return this.liquidated || (this.candleIndex >= this.candles.length - 1 && this.tickIndex >= this.currentTicks.length)
  }

  /** 已完整走完的 K 線（不含目前進行中的那一根） */
  get completedCandles(): Candle[] {
    return this.candles.slice(0, this.candleIndex)
  }

  get equity(): number {
    return this.cash + this.qty * this.price
  }

  get unrealized(): number {
    return this.qty === 0 ? 0 : this.qty * (this.price - this.avgEntry)
  }

  /** 以目前價格與槓桿，還能新增的名目金額（單向增加部位） */
  get buyingPower(): number {
    return Math.max(0, this.equity * this.leverage - Math.abs(this.qty) * this.price)
  }

  /** 前進一個 tick。回傳是否有前進。 */
  step(): boolean {
    if (this.finished) return false
    if (this.tickIndex >= this.currentTicks.length) {
      this.candleIndex++
      const c = this.candles[this.candleIndex]!
      this.currentTicks = ticksForCandle(c, this.ticksPerCandle, this.rng)
      this.tickIndex = 0
      this.current = { t: c.t, o: c.o, h: c.o, l: c.o, c: c.o, v: 0 }
    }
    const src = this.candles[this.candleIndex]!
    const p = this.currentTicks[this.tickIndex]!
    this.tickIndex++
    this.price = p
    const cur = this.current
    cur.h = Math.max(cur.h, p)
    cur.l = Math.min(cur.l, p)
    cur.c = p
    cur.v = (src.v * this.tickIndex) / this.currentTicks.length
    this.afterPriceMove()
    return true
  }

  private afterPriceMove() {
    const eq = this.equity
    if (eq > this.peakEquity) this.peakEquity = eq
    const dd = this.peakEquity > 0 ? ((this.peakEquity - eq) / this.peakEquity) * 100 : 0
    if (dd > this.maxDrawdownPct) this.maxDrawdownPct = dd
    if (this.qty !== 0 && eq <= 0) {
      this.execute(this.qty > 0 ? 'sell' : 'buy', Math.abs(this.qty), true)
      this.liquidated = true
    }
  }

  buy(qty: number): Trade {
    return this.execute('buy', qty)
  }

  sell(qty: number): Trade {
    return this.execute('sell', qty)
  }

  /** 以「名目金額」下單，方便 UI 用比例下單。 */
  buyNotional(amount: number): Trade {
    return this.buy(amount / this.price)
  }

  sellNotional(amount: number): Trade {
    return this.sell(amount / this.price)
  }

  closeAll(): Trade | null {
    if (this.qty === 0) return null
    return this.execute(this.qty > 0 ? 'sell' : 'buy', Math.abs(this.qty), true)
  }

  private execute(side: Side, qty: number, force = false): Trade {
    if (!(qty > 0) || !Number.isFinite(qty)) throw new OrderError('數量必須大於 0')
    if (this.finished && !force) throw new OrderError('本局已結束')
    const dq = side === 'buy' ? qty : -qty
    const x = this.price
    const fee = qty * x * this.feeRate
    const q = this.qty

    // 計算實現損益與新均價
    let realized = 0
    let newQty = q + dq
    let newAvg = this.avgEntry
    if (q === 0 || Math.sign(q) === Math.sign(dq)) {
      newAvg = (Math.abs(q) * this.avgEntry + Math.abs(dq) * x) / Math.abs(newQty)
    } else {
      const closed = Math.min(Math.abs(dq), Math.abs(q))
      realized = closed * (x - this.avgEntry) * Math.sign(q)
      if (Math.abs(dq) > Math.abs(q)) newAvg = x // 反手：剩餘部分以成交價為新均價
    }
    if (Math.abs(newQty) < 1e-12) {
      newQty = 0
      newAvg = 0
    }

    const equityAfter = this.cash - dq * x - fee + newQty * x
    // 只要會增加曝險就檢查槓桿上限；減倉一律允許
    if (!force && Math.abs(newQty) > Math.abs(q) + 1e-12) {
      if (equityAfter <= 0 || Math.abs(newQty) * x > equityAfter * this.leverage + 1e-9) {
        throw new OrderError('超過可用額度（槓桿上限）')
      }
    }

    this.cash += -dq * x - fee
    this.qty = newQty
    this.avgEntry = newAvg
    this.realized += realized
    this.totalFees += fee
    const trade: Trade = { side, qty, price: x, fee, realized, candleIndex: this.candleIndex }
    this.trades.push(trade)
    return trade
  }

  /** 結算：先平掉所有部位，再回傳成績。 */
  settle(): Settlement {
    this.closeAll()
    const finalEquity = this.cash
    const pnl = finalEquity - this.initialCash
    return {
      startEquity: this.initialCash,
      finalEquity,
      pnl,
      pnlPct: (pnl / this.initialCash) * 100,
      trades: this.trades.length,
      totalFees: this.totalFees,
      maxDrawdownPct: this.maxDrawdownPct,
      liquidated: this.liquidated,
    }
  }
}
