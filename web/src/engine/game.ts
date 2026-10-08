import type { BracketInput, Candle, FillReason, GameOptions, Order, OrderType, Settlement, Side, Trade } from './types'
import { createRng, type Rng } from './rng'
import { ticksForCandle } from './ticks'

export class OrderError extends Error {}

const EPS = 1e-9

/**
 * 單局遊戲引擎：播放時鐘 + 帳戶 + 下單 + 結算。
 * 純 TypeScript，不依賴 Vue / DOM。同樣的 candles + seed 會得到完全相同的 tick 序列。
 *
 * 價格模型：price 為「中間價」；買單成交價 = 中間價 ×（1 + 半價差 + 滑價），賣單反之。
 * 限價單與止盈以掛單價成交（無價差、無滑價、maker 費率）；市價、停損、止損、強平以 taker 成交。
 * 持倉採「淨部位」：同一標的只有一個多空部位，止盈止損綁在整個部位上。
 */
export class Game {
  readonly initialCash: number
  readonly takerFeeRate: number
  readonly makerFeeRate: number
  readonly spreadPct: number
  readonly slippagePct: number
  readonly maintenanceMarginRate: number
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

  /** 持倉的止盈 / 止損 / 追蹤停損（價格） */
  tp: number | null = null
  sl: number | null = null
  trail: number | null = null
  private anchor = 0

  /** 尚未成交的掛單 */
  orders: Order[] = []
  /** 引擎事件訊息（掛單被拒、強平等），由 UI 取走顯示 */
  messages: string[] = []
  private nextOrderId = 1

  candleIndex = 0
  private tickIndex = 0
  private currentTicks: number[]
  price: number
  private peakEquity: number
  maxDrawdownPct = 0
  /** 每根 K 線收盤時的淨值（索引 = candleIndex），供復盤畫權益曲線 */
  equityByCandle: number[] = []
  /** 目前這根 K 線「到目前為止」的樣子 */
  current: Candle

  private readonly rng: Rng

  constructor(
    readonly candles: Candle[],
    opts: GameOptions = {},
  ) {
    if (candles.length === 0) throw new Error('candles 不可為空')
    this.initialCash = opts.initialCash ?? 10000
    this.takerFeeRate = opts.takerFeeRate ?? 0.0005
    this.makerFeeRate = opts.makerFeeRate ?? 0.0002
    this.spreadPct = opts.spreadPct ?? 0.0001
    this.slippagePct = opts.slippagePct ?? 0.0001
    this.maintenanceMarginRate = opts.maintenanceMarginRate ?? 0.005
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

  // ───────────── 狀態查詢 ─────────────

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

  get exposure(): number {
    return Math.abs(this.qty) * this.price
  }

  /** 已占用保證金 = 曝險 / 槓桿 */
  get usedMargin(): number {
    return this.exposure / this.leverage
  }

  /** 以目前價格與槓桿，還能新增的名目金額（單向增加部位） */
  get buyingPower(): number {
    return Math.max(0, this.equity * this.leverage - this.exposure)
  }

  /** 強平價；沒有部位或不可能被強平（例如 1x 做多）回傳 null */
  get liquidationPrice(): number | null {
    const q = this.qty
    if (q === 0) return null
    const m = this.maintenanceMarginRate
    if (q > 0) {
      const p = -this.cash / (q * (1 - m))
      return p > 0 ? p : null
    }
    return this.cash / (-q * (1 + m))
  }

  /** 取走並清空引擎訊息 */
  drainMessages(): string[] {
    const m = this.messages
    this.messages = []
    return m
  }

  // ───────────── 播放 ─────────────

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
    this.checkLiquidation()
    if (!this.liquidated) {
      this.processOrders()
      this.processBracket()
    }
    const eq = this.equity
    this.equityByCandle[this.candleIndex] = eq
    if (eq > this.peakEquity) this.peakEquity = eq
    const dd = this.peakEquity > 0 ? ((this.peakEquity - eq) / this.peakEquity) * 100 : 0
    if (dd > this.maxDrawdownPct) this.maxDrawdownPct = dd
  }

  private checkLiquidation() {
    if (this.qty === 0) return
    if (this.equity > this.exposure * this.maintenanceMarginRate) return
    this.execute(this.qty > 0 ? 'sell' : 'buy', Math.abs(this.qty), 'liquidation')
    // 交易所不會讓帳戶負債：虧損最多就是整個帳戶
    if (this.cash < 0) this.cash = 0
    this.liquidated = true
    this.orders = []
    this.messages.push('已觸發強制平倉（爆倉）')
  }

  private processOrders() {
    if (this.orders.length === 0) return
    for (const o of [...this.orders]) {
      const hit = this.orderTriggered(o)
      if (!hit) continue
      this.orders = this.orders.filter((x) => x.id !== o.id)
      try {
        const before = this.qty
        this.execute(o.side, o.qty, o.type === 'limit' ? 'limit' : 'stop', o.type === 'limit' ? o.price : undefined)
        this.attachBracket(o, before)
      } catch (e) {
        if (!(e instanceof OrderError)) throw e
        this.messages.push(`掛單 #${o.id} 觸發但無法成交：${e.message}`)
      }
      if (this.liquidated) break
    }
  }

  private orderTriggered(o: Order): boolean {
    const p = this.price
    if (o.type === 'limit') return o.side === 'buy' ? p <= o.price : p >= o.price
    return o.side === 'buy' ? p >= o.price : p <= o.price
  }

  private processBracket() {
    if (this.qty === 0) return
    const long = this.qty > 0
    const p = this.price
    // 追蹤停損：止損價跟著有利方向的極值移動
    if (this.trail != null) {
      if (long) {
        this.anchor = Math.max(this.anchor, p)
        this.sl = Math.max(this.sl ?? -Infinity, this.anchor - this.trail)
      } else {
        this.anchor = Math.min(this.anchor, p)
        this.sl = Math.min(this.sl ?? Infinity, this.anchor + this.trail)
      }
    }
    const side: Side = long ? 'sell' : 'buy'
    const q = Math.abs(this.qty)
    if (this.sl != null && (long ? p <= this.sl : p >= this.sl)) {
      this.execute(side, q, 'sl')
      return
    }
    if (this.tp != null && (long ? p >= this.tp : p <= this.tp)) {
      this.execute(side, q, 'tp', this.tp)
    }
  }

  // ───────────── 下單 ─────────────

  /** 市價單（可附帶止盈止損） */
  buy(qty: number, bracket?: BracketInput): Trade {
    return this.market('buy', qty, bracket)
  }

  sell(qty: number, bracket?: BracketInput): Trade {
    return this.market('sell', qty, bracket)
  }

  /** 以「名目金額」下單，方便 UI 用金額 / 比例下單。 */
  buyNotional(amount: number, bracket?: BracketInput): Trade {
    return this.buy(amount / this.price, bracket)
  }

  sellNotional(amount: number, bracket?: BracketInput): Trade {
    return this.sell(amount / this.price, bracket)
  }

  private market(side: Side, qty: number, bracket?: BracketInput): Trade {
    this.assertTradable(qty)
    if (bracket) this.validateBracket(side === 'buy' ? 1 : -1, this.price, bracket)
    const before = this.qty
    const t = this.execute(side, qty, 'market')
    if (bracket) this.attachBracket({ side, ...bracket }, before)
    return t
  }

  /**
   * 限價單。買單價格 >= 現價（或賣單 <= 現價）等於立刻可成交，直接以市價成交；
   * 否則掛單等價格走到。
   */
  placeLimit(side: Side, qty: number, price: number, bracket?: BracketInput): Order | Trade {
    this.assertTradable(qty)
    this.assertPrice(price)
    if (side === 'buy' ? price >= this.price : price <= this.price) return this.market(side, qty, bracket)
    return this.addOrder('limit', side, qty, price, bracket)
  }

  /** 停損單（觸發後以市價成交）。買單須在現價上方、賣單須在現價下方。 */
  placeStop(side: Side, qty: number, price: number, bracket?: BracketInput): Order {
    this.assertTradable(qty)
    this.assertPrice(price)
    if (side === 'buy' && price <= this.price) throw new OrderError('買進停損價必須高於現價')
    if (side === 'sell' && price >= this.price) throw new OrderError('賣出停損價必須低於現價')
    return this.addOrder('stop', side, qty, price, bracket)
  }

  private addOrder(type: OrderType, side: Side, qty: number, price: number, bracket?: BracketInput): Order {
    const reduces = (side === 'sell' && this.qty > 0) || (side === 'buy' && this.qty < 0)
    if (!reduces && qty * price > this.buyingPower + EPS) throw new OrderError('超過可用額度（槓桿上限）')
    if (bracket) this.validateBracket(side === 'buy' ? 1 : -1, price, bracket)
    const order: Order = { id: this.nextOrderId++, type, side, qty, price, ...bracket }
    this.orders.push(order)
    return order
  }

  cancelOrder(id: number): boolean {
    const n = this.orders.length
    this.orders = this.orders.filter((o) => o.id !== id)
    return this.orders.length < n
  }

  cancelAll() {
    this.orders = []
  }

  closeAll(): Trade | null {
    if (this.qty === 0) return null
    return this.execute(this.qty > 0 ? 'sell' : 'buy', Math.abs(this.qty), 'market')
  }

  /** 平掉一部分（fraction 0~1） */
  closeFraction(fraction: number): Trade | null {
    if (this.qty === 0) return null
    if (!(fraction > 0)) throw new OrderError('比例必須大於 0')
    if (fraction >= 1) return this.closeAll()
    return this.execute(this.qty > 0 ? 'sell' : 'buy', Math.abs(this.qty) * fraction, 'market')
  }

  // ───────────── 止盈止損 ─────────────

  /**
   * 設定或修改持倉的止盈 / 止損 / 追蹤停損。欄位傳 null 代表清除，undefined 代表不變。
   * 多單：止盈須高於現價、止損須低於現價；空單相反。
   */
  setBracket(b: BracketInput) {
    if (this.qty === 0) throw new OrderError('目前沒有持倉')
    const dir = this.qty > 0 ? 1 : -1
    this.validateBracket(dir, this.price, b)
    if (b.tp !== undefined) this.tp = b.tp
    if (b.sl !== undefined) this.sl = b.sl
    if (b.trail !== undefined) {
      this.trail = b.trail
      this.anchor = this.price
      // 啟用追蹤停損時，若還沒有止損價就先放在 現價 ∓ 距離
      if (b.trail != null && b.sl === undefined && this.sl == null) this.sl = this.price - dir * b.trail
    }
  }

  private validateBracket(dir: 1 | -1, ref: number, b: BracketInput) {
    const { tp, sl, trail } = b
    if (tp != null) {
      this.assertPrice(tp)
      if (dir * (tp - ref) <= 0) throw new OrderError(dir > 0 ? '止盈價必須高於現價' : '止盈價必須低於現價')
    }
    if (sl != null) {
      this.assertPrice(sl)
      if (dir * (sl - ref) >= 0) throw new OrderError(dir > 0 ? '止損價必須低於現價' : '止損價必須高於現價')
    }
    if (trail != null && !(trail > 0)) throw new OrderError('追蹤停損距離必須大於 0')
  }

  private attachBracket(src: BracketInput & { side: Side }, qtyBefore: number) {
    const { tp, sl, trail } = src
    if (tp == null && sl == null && trail == null) return
    // 只有「開倉或加碼同方向」才附帶止盈止損；反向減倉不處理
    const dir = src.side === 'buy' ? 1 : -1
    if (this.qty === 0 || Math.sign(this.qty) !== dir) return
    if (qtyBefore !== 0 && Math.sign(qtyBefore) !== dir) return
    if (tp != null) this.tp = tp
    if (sl != null) this.sl = sl
    if (trail != null) {
      this.trail = trail
      this.anchor = this.price
      if (sl == null && this.sl == null) this.sl = this.price - dir * trail
    }
  }

  private clearBracket() {
    this.tp = null
    this.sl = null
    this.trail = null
    this.anchor = 0
  }

  // ───────────── 成交核心 ─────────────

  private assertTradable(qty: number) {
    if (!(qty > 0) || !Number.isFinite(qty)) throw new OrderError('數量必須大於 0')
    if (this.finished) throw new OrderError('本局已結束')
  }

  private assertPrice(p: number) {
    if (!(p > 0) || !Number.isFinite(p)) throw new OrderError('價格必須大於 0')
  }

  /**
   * 實際成交。reason 決定費率與價格：
   * limit / tp 以 limitPrice 成交（maker）；其他以中間價 ± 價差滑價成交（taker）。
   * market 以外的原因（止盈止損、強平、掛單觸發）視為被動成交，不檢查額度。
   */
  private execute(side: Side, qty: number, reason: FillReason, limitPrice?: number): Trade {
    if (!(qty > 0) || !Number.isFinite(qty)) throw new OrderError('數量必須大於 0')
    const dir = side === 'buy' ? 1 : -1
    const dq = dir * qty
    const maker = reason === 'limit' || reason === 'tp'
    const x = maker && limitPrice !== undefined ? limitPrice : this.price * (1 + dir * (this.spreadPct / 2 + this.slippagePct))
    const fee = qty * x * (maker ? this.makerFeeRate : this.takerFeeRate)
    const q = this.qty

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

    // 會增加曝險的主動單（市價 / 掛單觸發）才檢查額度；減倉與強平一律允許
    if (reason !== 'liquidation' && Math.abs(newQty) > Math.abs(q) + 1e-12) {
      const equityAfter = this.cash - dq * x - fee + newQty * x
      if (equityAfter <= 0 || Math.abs(newQty) * x > equityAfter * this.leverage + 1e-9) {
        throw new OrderError('超過可用額度（槓桿上限）')
      }
    }

    this.cash += -dq * x - fee
    this.qty = newQty
    this.avgEntry = newAvg
    this.realized += realized
    this.totalFees += fee
    // 部位歸零或反手：舊的止盈止損作廢
    if (newQty === 0 || Math.sign(newQty) !== Math.sign(q)) this.clearBracket()
    const trade: Trade = { side, qty, price: x, fee, realized, candleIndex: this.candleIndex, reason }
    this.trades.push(trade)
    return trade
  }

  /** 結算：取消掛單、平掉所有部位，再回傳成績。 */
  settle(): Settlement {
    this.cancelAll()
    this.closeAll()
    const finalEquity = this.cash
    this.equityByCandle[this.candleIndex] = finalEquity
    const equityCurve = [this.initialCash, ...Array.from({ length: this.candleIndex + 1 }, (_, i) => this.equityByCandle[i] ?? this.initialCash)]
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
      equityCurve,
    }
  }
}
