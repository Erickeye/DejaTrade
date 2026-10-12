// 成績分享圖：1200×630（社群分享常見的橫幅比例），純 Canvas 繪製，不依賴任何外部資源。
// 每日挑戰與盲測局不寫出標的與日期，避免對還沒玩的人劇透。

export interface ShareInput {
  daily: boolean
  blind: boolean
  /** 實況局的標題（例如 BTC · 2025-03-12） */
  label: string
  /** 每日挑戰的日期 */
  dailyDate: string
  leverage: number
  pnl: number
  pnlPct: number
  equity: number[]
  winRate: number | null
  trades: number
  maxDrawdownPct: number
  payoff: number | null
  liquidated: boolean
  synthetic: boolean
  siteUrl: string
}

export interface ShareData {
  subtitle: string
  tags: string[]
  pnl: number
  pnlPct: number
  equity: number[]
  rows: [string, string][]
  siteUrl: string
}

const sign = (n: number, d: number) => (n > 0 ? '+' : '') + n.toFixed(d)

export function buildShareData(i: ShareInput): ShareData {
  const subtitle = i.daily ? `今日挑戰 · ${i.dailyDate}` : i.blind ? '盲測局' : i.label
  const tags = [`槓桿 ${i.leverage}x`]
  if (i.liquidated) tags.push('爆倉')
  if (i.synthetic) tags.push('合成資料')
  return {
    subtitle,
    tags,
    pnl: i.pnl,
    pnlPct: i.pnlPct,
    equity: i.equity,
    rows: [
      ['交易筆數', String(i.trades)],
      ['勝率', i.winRate == null ? '—' : (i.winRate * 100).toFixed(0) + '%'],
      ['盈虧比', i.payoff == null ? '—' : i.payoff.toFixed(2)],
      ['最大回撤', i.maxDrawdownPct.toFixed(2) + '%'],
    ],
    siteUrl: i.siteUrl,
  }
}

export const CARD_W = 1200
export const CARD_H = 630

export function drawShareCard(canvas: HTMLCanvasElement, d: ShareData): void {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const c = canvas.getContext('2d')
  if (!c) return
  const font = (px: number, weight = 400) => `${weight} ${px}px system-ui, "Noto Sans TC", "Microsoft JhengHei", sans-serif`
  const up = '#26a69a', down = '#ef5350', dim = '#8a93a6', text = '#e6e9ef', accent = '#f5b942'
  const color = d.pnl > 0 ? up : d.pnl < 0 ? down : dim

  c.fillStyle = '#0f1218'
  c.fillRect(0, 0, CARD_W, CARD_H)
  c.fillStyle = '#171c26'
  c.beginPath(); c.roundRect(30, 30, CARD_W - 60, CARD_H - 60, 24); c.fill()
  c.strokeStyle = '#262d3b'; c.lineWidth = 2; c.stroke()

  // 左側：品牌、標題、損益
  c.textBaseline = 'alphabetic'
  c.fillStyle = text; c.font = font(40, 700); c.fillText('DejaTrade', 80, 120)
  c.fillStyle = dim; c.font = font(24); c.fillText('歷史行情當沖模擬器', 80, 156)
  c.fillStyle = text; c.font = font(32, 600); c.fillText(d.subtitle, 80, 232)
  let x = 80
  for (const t of d.tags) {
    c.font = font(20, 600)
    const w = c.measureText(t).width + 28
    c.fillStyle = t === '爆倉' ? '#ff9800' : '#262d3b'
    c.beginPath(); c.roundRect(x, 252, w, 36, 18); c.fill()
    c.fillStyle = t === '爆倉' ? '#1a1405' : dim
    c.fillText(t, x + 14, 277)
    x += w + 10
  }
  c.fillStyle = color; c.font = font(112, 700); c.fillText(sign(d.pnlPct, 2) + '%', 76, 420)
  c.fillStyle = dim; c.font = font(28); c.fillText(`損益 ${sign(d.pnl, 2)} USD`, 80, 466)

  // 統計
  c.font = font(24)
  d.rows.forEach(([k, v], idx) => {
    const col = idx % 2, row = Math.floor(idx / 2)
    const px = 80 + col * 250, py = 520 + row * 40
    c.fillStyle = dim; c.fillText(k, px, py)
    c.fillStyle = text; c.font = font(24, 700); c.fillText(v, px + 120, py); c.font = font(24)
  })

  // 右側：淨值曲線
  const gx = 640, gy = 120, gw = 480, gh = 340
  c.fillStyle = '#0f1218'; c.beginPath(); c.roundRect(gx, gy, gw, gh, 16); c.fill()
  const v = d.equity
  if (v.length >= 2) {
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1
    const px = (i: number) => gx + 20 + (i / (v.length - 1)) * (gw - 40)
    const py = (n: number) => gy + gh - 24 - ((n - lo) / span) * (gh - 48)
    c.setLineDash([8, 8]); c.strokeStyle = dim; c.lineWidth = 1.5
    c.beginPath(); c.moveTo(gx + 20, py(v[0]!)); c.lineTo(gx + gw - 20, py(v[0]!)); c.stroke(); c.setLineDash([])
    c.strokeStyle = color; c.lineWidth = 4; c.lineJoin = 'round'
    c.beginPath(); v.forEach((n, i) => (i ? c.lineTo(px(i), py(n)) : c.moveTo(px(i), py(n)))); c.stroke()
  }
  c.fillStyle = dim; c.font = font(20); c.fillText('淨值曲線', gx + 20, gy + gh + 34)

  // 頁尾
  c.fillStyle = accent; c.font = font(24, 600); c.textAlign = 'right'
  c.fillText(d.siteUrl, CARD_W - 80, CARD_H - 62)
  c.textAlign = 'left'
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('無法產生圖片'))), 'image/png'))
}
