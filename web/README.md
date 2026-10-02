# DejaTrade web

```bash
npm install
npm run gen:sample   # 產生合成樣本資料到 public/data（真實資料之後由 C# DataTool 匯出）
npm run dev          # 開發伺服器
npm test             # 引擎單元測試（Vitest）
npm run build        # 型別檢查 + 建置
```

- `src/engine/`：純 TS 遊戲引擎（不依賴 Vue / DOM）。
- `src/stores/game.ts`：Pinia，負責載入資料、播放時鐘、下單。
- `src/components/CandleChart.vue`：Lightweight Charts 封裝。
- `src/views/Simulator.vue`：模擬器畫面。
