# DejaTrade web

```bash
npm install
npm run fetch:binance   # 抓 Binance 真實 1 分鐘 K 線（BTC/ETH/SOL，各 20 天）到 public/data
npm run fetch:fx        # 抓 Dukascopy 外匯 1 分鐘 K 線（EURUSD/GBPUSD/USDJPY，各 10 天）
npm run gen:sample      # 或：產生合成假資料（含外匯，離線時用）
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

`fetch:fx` 參數：`-- --from 2025-01-01 --to 2026-09-30 --per 10 --symbols EURUSD,GBPUSD,USDJPY --weekdays 1,2,3,4`（預設只抽週一到週四，週五晚間市場收盤、K 線不完整）。
Dukascopy 網站條款限制為個人、非商業使用，且不得再散布；`public/data/` 與 `.dukascopy-cache/` 都不進版控，請勿公開部署這些資料。
`fetch:binance` 與 `fetch:fx` 各自只替換自己的資產類別，不會清掉對方的資料。

## 部署網頁版（GitHub Pages）

推到 `main` 會由 `.github/workflows/deploy.yml` 自動建置並部署。第一次需要在 GitHub 專案：
**Settings → Pages → Build and deployment → Source 選 "GitHub Actions"**。

公開站的資料策略（授權考量）：

- **加密貨幣**：建置時設定 `VITE_LIVE_CRYPTO=1`，由訪客的瀏覽器直接向 Binance 公開行情端點
  （`data-api.binance.vision`）即時下載 1 分鐘 K 線，我們不儲存、不轉散布。下載失敗會退回合成資料並提示。
- **外匯**：只放程式產生的合成資料（`npm run gen:sample`）。Dukascopy 資料僅限個人使用，
  workflow 內有檢查，若 `dist` 內出現非合成的外匯檔會直接中止部署。
- 本機想用真實資料時照舊：`npm run fetch:binance` / `npm run fetch:fx`，再 `npm run dev`
  （不設 `VITE_LIVE_CRYPTO` 就走靜態題庫）。
