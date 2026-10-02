# DejaTrade

投資題材的網頁遊戲（Simulator + 小遊戲），用於作品集展示。

**開始任何工作前，請先閱讀 `PROJECT_BRIEF.md`**，其中記錄了專案定位、核心玩法、技術決策、資料來源限制、架構原則與開發路線。

## 重點摘要

- 技術棧：Vue 3 + TypeScript + Pinia + Vite；圖表用 Lightweight Charts；資料處理用 C# Console（DejaTrade.DataTool，LiteDB 快取）輸出靜態 JSON（以 PROJECT_BRIEF.md v2 為準）。
- 遊戲引擎（成交、損益、爆倉）須與 UI 分離，寫成純 TypeScript 模組並附單元測試。
- 與使用者溝通一律使用繁體中文。
- 有新的決策時，請同步更新 `PROJECT_BRIEF.md`。
