import type { DayMeta, GameOptions } from './types'

/** 各資產類別可選的槓桿 */
export const LEVERAGE_OPTIONS: Record<string, number[]> = {
  crypto: [1, 5, 20],
  fx: [10, 30, 100],
}
export const DEFAULT_LEVERAGE: Record<string, number> = { crypto: 1, fx: 30 }
export const LOT_UNITS = 100_000

export const leverageOptions = (asset: string) => LEVERAGE_OPTIONS[asset] ?? [1, 5, 20]
export const defaultLeverage = (asset: string) => DEFAULT_LEVERAGE[asset] ?? 1

/**
 * 依資產類別決定交易成本模型：
 * - 加密貨幣：比例手續費（maker / taker）+ 小價差，維持保證金率 0.5%
 * - 外匯：沒有手續費，成本是點差（pip）+ 少量滑價；保證金低於已占用保證金的 50% 即強制平倉（stop-out）
 */
export function gameOptionsForDay(asset: string, meta: DayMeta, leverage: number, seed: number): GameOptions {
  if (asset !== 'fx') return { seed, leverage }
  const pip = meta.pipSize ?? 0.0001
  return {
    seed,
    leverage,
    takerFeeRate: 0,
    makerFeeRate: 0,
    spreadPct: ((meta.spreadPips ?? 0.6) * pip) / meta.scale,
    slippagePct: (0.1 * pip) / meta.scale,
    maintenanceMarginRate: 0.5 / leverage,
  }
}

/** 1 手（100,000 基礎貨幣）折合的美元名目金額。美元是報價貨幣（EURUSD）要乘上價格；美元是基礎貨幣（USDJPY）就是 100,000。 */
export function lotNotionalUsd(meta: DayMeta, displayPrice: number): number {
  return LOT_UNITS * (meta.usdIsQuote === false ? 1 : displayPrice)
}

/** BTCUSDT → BTC；EURUSD → EUR/USD */
export function symbolLabel(symbol: string, asset: string): string {
  if (asset === 'fx') return symbol.length === 6 ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol
  return symbol.replace(/USDT$/, '')
}

/** 引擎部位數量 → 手數（以該筆價位換算；qty × 正規化價格 = 美元名目金額） */
export function lotsFromQty(meta: DayMeta, qty: number, normPrice: number, k: number): number {
  return (Math.abs(qty) * normPrice) / lotNotionalUsd(meta, normPrice * k)
}
