import type { DayIndex } from './types'
import { createRng, hashString, type Rng } from './rng'

export function pickDay(index: DayIndex, rng: Rng) {
  if (index.days.length === 0) throw new Error('index 內沒有可抽的交易日')
  return index.days[Math.floor(rng() * index.days.length)]!
}

/** 每日挑戰：以日期字串為種子，同一份 index 下所有玩家抽到同一局。 */
export function dailySeed(dateStr: string): number {
  return hashString(`dejatrade:${dateStr}`)
}

export function pickDailyDay(index: DayIndex, dateStr: string) {
  return pickDay(index, createRng(dailySeed(dateStr)))
}
