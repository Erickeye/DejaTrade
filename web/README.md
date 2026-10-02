# DejaTrade web

```bash
npm install
npm run fetch:binance   # 抓 Binance 真實 1 分鐘 K 線（BTC/ETH/SOL，各 20 天）到 public/data
npm run gen:sample      # 或：產生合成假資料（離線時用）
npm run dev          # 開發伺服器
npm test             # 引擎單元測試（Vitest）
npm run build        # 型別檢查 + 建置
```

- `src/engine/`：純 TS 遊戲引擎（不依賴 Vue / DOM）。
- `src/stores/game.ts`：Pinia，負責載入資料、播放時鐘、下單。
- `src/components/CandleChart.vue`：Lightweight Charts 封裝。
- `src/views/Simulator.vue`：模擬器畫面。

`fetch:binance` 參數：`-- --from 2025-01-01 --to 2026-09-30 --per 15 --symbols BTCUSDT,ETHUSDT,SOLUSDT`。
`public/data/` 不進版控，clone 後需先執行其中一個資料指令。
