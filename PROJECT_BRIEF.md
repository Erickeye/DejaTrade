# DejaTrade 專案規劃書（Project Brief）

> 本文件整理自專案發想階段的對話（2026-10-02），供後續專案對話接續使用。
> **版本：v2（已採用方案 A：靜態網頁 + C# 資料工具）。**
> 有新決策請直接更新本文件，作為專案的單一事實來源；重大決策同步記在「決策紀錄」。

---

## 1. 專案定位

- **名稱**：DejaTrade（暫定；候選名：Candle Arcade、Rewind Market、Ticker Roulette）
- **目的**：個人 side project，用於**作品集**。目標是「好玩、面試官點開網址就能玩」，並在面試時展示技術深度。
- **類型**：投資題材的**單機網頁遊戲**，包含 **Simulator（模擬器）** 與**小遊戲**。
- **作者背景**：.NET 後端工程師，熟 Vue。專案刻意讓 C#（資料管線）與 Vue + TypeScript（遊戲本體）各自發揮。
- **差異化**：現有產品（ChartMini、ReplayTrader、FX Replay、Forex Tester、simul8or、Tradicted 等）多為專業交易練習工具、英文為主、遊戲感薄弱。DejaTrade 走「遊戲化 + 盲測 + 華語介面」。

## 2. 核心玩法

1. 從預先處理好的歷史資料中，**隨機抽一個標的 + 一個交易日**（約 3 年內）。
2. 以該日分時 K 線逐根（或逐 tick）播放，玩家即時買賣（當沖）。
3. **去識別化**：隱藏標的與日期，價格正規化（第一根開盤價 = 100），避免玩家靠記憶判斷。
4. 結算損益，局後**揭曉真實標的與日期**。
5. 支援標的分階段加入：加密貨幣 → 外匯 → 股票。

### 遊戲化構想（待排優先順序）
- 每日挑戰：用「日期當隨機種子」，全球玩家當天抽到同一局，**不需伺服器**。
- 成就、關卡、本機歷史戰績與統計。
- 黑天鵝事件日回放（可配新聞）。
- 風險體驗：槓桿、爆倉。
- 華語介面（zh-TW 優先）。

### 小遊戲構想（Arcade 的其他「機台」，皆為暫定）
- **猜漲跌**：看一段 K 線，猜下一根漲或跌，比連勝。
- **盲測辨識**：給一段正規化走勢，猜是哪類資產或哪種事件。
- **爆倉前平倉**：高槓桿下的反應速度挑戰。
- 以上都能共用同一套資料與引擎，開發成本低。

### 產品結構
首頁是「遊戲廳（Arcade）」：Simulator 為其中一台，其他小遊戲為其他機台。

---

## 3. 架構（方案 A）

### 3.1 總覽

```
 ┌─────────────────────────── 離線（開發者本機）───────────────────────────┐
 │  DejaTrade.DataTool（C# Console）                                        │
 │   抓取 → 統一格式 → LiteDB 本機快取 → 品質篩選 → 匯出靜態 JSON            │
 └───────────────────────────────┬────────────────────────────────────────┘
                                 │  web/public/data/**/*.json
 ┌───────────────────────────────▼────────────────────────────────────────┐
 │  web（Vue 3 + TypeScript + Vite，純靜態網站）                            │
 │   engine（純 TS 遊戲引擎，含單元測試）                                    │
 │   Pinia 狀態 · Lightweight Charts 圖表 · IndexedDB 存檔                  │
 └────────────────────────────────────────────────────────────────────────┘
```

- **沒有後端伺服器**：單機遊戲，作弊只影響玩家自己，因此不做伺服器權威判定、不用 SignalR / Redis / 線上排行榜驗證。
- **LiteDB 只用在資料工具**：當作抓取資料的本機快取（支援增量更新、查詢），不在瀏覽器裡執行。
- **遊戲存檔用 IndexedDB**（瀏覽器端），例如搭配 Dexie 或 idb。

### 3.2 技術棧

| 層面 | 決定 | 備註 |
|---|---|---|
| 前端框架 | Vue 3 + TypeScript | 使用者熟 Vue；TS 為求職加分且讓交易邏輯更可靠 |
| 狀態管理 | Pinia | |
| 建置工具 | Vite | |
| 圖表 | Lightweight Charts（TradingView 開源） | 純 JS，與框架無關 |
| 遊戲引擎 | 純 TypeScript 模組（`web/src/engine`） | 與 UI 完全分離；Vitest 單元測試 |
| 存檔 | IndexedDB | 戰績、統計、成就、設定 |
| 資料工具 | C# Console（使用已安裝的 .NET LTS） | xUnit 測試 |
| 資料快取 | LiteDB | 僅資料工具使用，檔案不進版控 |
| 部署 | Vercel / Cloudflare Pages / GitHub Pages | 免費靜態託管 |
| CI | GitHub Actions | `dotnet test` + `vitest` + build + 部署 |

### 3.3 預計目錄結構

```
DejaTrade/
├─ tools/
│  └─ DejaTrade.DataTool/          # C# 資料管線（Console）
├─ tests/
│  └─ DejaTrade.DataTool.Tests/    # xUnit
├─ web/                            # Vue 3 + TS + Vite
│  ├─ src/
│  │  ├─ engine/                   # 純 TS 引擎（不得 import Vue / DOM）
│  │  ├─ stores/                   # Pinia
│  │  ├─ views/                    # Arcade 首頁、Simulator、各小遊戲
│  │  ├─ components/
│  │  └─ storage/                  # IndexedDB 存取
│  └─ public/data/
│     ├─ index.json                # 所有可抽的交易日索引
│     └─ days/{asset}/{dayId}.json # 單日 K 線
├─ data-cache/                     # LiteDB 檔（.gitignore）
├─ docs/
├─ .github/workflows/
├─ PROJECT_BRIEF.md
├─ CLAUDE.md
└─ README.md
```

---

## 4. 資料管線（DejaTrade.DataTool）

### 4.1 資料來源評估（2026-10-02 查證）

| 資產 | 來源 | 可行性 | 說明 |
|---|---|---|---|
| 加密貨幣 | Binance 公開資料 | **容易（先做）** | 現貨與期貨的每日 / 每月壓縮檔；K 線 1s 到 1mo 皆有；部分交易對可回溯至 2020-08；免費、免 API 金鑰 |
| 外匯 | Dukascopy | 中等（第二階段） | 免費；tick / 分鐘 / 小時等週期；1000+ 商品；歷史自 1990–2000 年代起。開源工具 dukascopy-node 為 Node.js，可呼叫其 CLI 或自行用 C# 下載 |
| 美股 | Alpaca 免費方案 | 較麻煩（最後） | 每分鐘 200 次呼叫、歷史資料延遲 15 分鐘（回放舊資料不受影響）。**免費方案分鐘線可回溯多久尚未查證，開工前先確認**。Polygon 免費方案僅日線且每分鐘 5 次，不適用 |
| 台股 | FinMind | 暫不做 | 分 K 與逐筆為贊助會員（付費）限定，免費僅日線。券商 API（如永豐 Shioaji）需開戶，細節未查證 |

### 4.2 授權與散布風險（重要）

方案 A 會把處理後的 JSON 公開在網站上，等同散布市場資料：

- Binance 的 GitHub 專案採 MIT，但那只涵蓋程式碼；README 未說明市場資料本身能否再散布。
- Dukascopy、Alpaca 的使用條款尚未查證。
- **降低風險的作法**：先只做加密貨幣與外匯；只釋出精選的樣本交易日而非完整資料集；價格正規化並隱藏日期（本來就是玩法）；**公開前務必逐一閱讀各平台使用條款**。
- 這是風險提醒，並非法律意見。

### 4.3 流程

1. **抓取**：依資產類別下載原始資料（Binance：解壓 CSV；外匯：呼叫工具或自行下載）。實作時再確認 URL 與欄位格式。
2. **統一格式**：`Candle { Time(UTC), Open, High, Low, Close, Volume }`。
3. **LiteDB 快取**：以 `(Symbol, Interval, Time)` 為鍵並建索引；抓取需冪等、可增量更新；另存抓取紀錄避免重抓。
4. **切分交易日**：每個資產類別定義自己的「一天」（見 4.5）。
5. **品質篩選**：剔除缺漏率過高、成交量過低或幾乎不動的日子（門檻待實測決定）。
6. **匯出**：每個交易日一個 JSON，外加 `index.json`。

### 4.4 輸出 JSON 格式（草案）

`index.json`：
```json
{
  "version": 1,
  "days": [
    { "id": "crypto-0001", "asset": "crypto", "file": "days/crypto/crypto-0001.json" }
  ]
}
```

單日檔（價格已正規化，第一根開盤 = 100；`meta` 供局後揭曉用）：
```json
{
  "id": "crypto-0001",
  "asset": "crypto",
  "interval": "1m",
  "meta": { "symbol": "BTCUSDT", "date": "2024-03-12", "scale": 71234.5 },
  "candles": [[0, 100.0, 100.3, 99.8, 100.1, 12.5], [60, 100.1, 100.4, 100.0, 100.2, 9.8]]
}
```
- `candles` 每筆為 `[offsetSec, open, high, low, close, volume]`，用陣列以縮小體積。
- 單日約 1440 根（加密貨幣），壓縮後約數十 KB。
- `meta` 放在檔案內代表玩家用開發者工具可偷看；單機遊戲可接受，若在意可之後改為局後才載入。

### 4.5 「一天」的定義

| 資產 | 範圍 |
|---|---|
| 加密貨幣 | 24/7，以 UTC 0:00–24:00 為一天 |
| 外匯 | 週一至週五連續交易，需處理週末缺口 |
| 股票 | 固定交易時段；需處理休市、漲跌停、開盤缺口 |

引擎應讓每種資產自行定義一局的起訖。

---

## 5. 遊戲引擎（web/src/engine）

- **純 TypeScript**，不得依賴 Vue 或 DOM，方便單元測試與日後重用。
- 職責：播放時鐘、帳戶（現金 / 部位 / 損益）、下單（市價買賣、平倉；做空與槓桿列為進階）、手續費 / 點差 / 滑價模型、爆倉判定、局結算。
- **K 線內 tick 模擬**：1 分鐘 K 線只有 OHLC，可用 seeded RNG 生成 `O → (H/L) → (L/H) → C` 的路徑，讓畫面逐 tick 跳動，且**同種子結果可重現**。
- **確定性**：所有隨機都經由可注入的 seeded RNG，每日挑戰與測試皆依此運作。
- **測試**：Vitest 覆蓋成交、損益、爆倉、種子重現、邊界情況（空倉平倉、資金不足等）。

## 6. 存檔與每日挑戰

- **IndexedDB 存**：歷史戰績、統計、成就、設定。
- **每日挑戰**：`seed = hash(日期字串)` 從 `index.json` 決定當天的局；同一版資料下全球玩家抽到同一局，無需伺服器。成績只存本機，可提供「複製分享文字」。
- 若日後需要真正的線上排行榜，再評估 Supabase / Firebase（目前**不在範圍內**）。

---

## 7. 開發路線

### Phase 0：專案骨架
- [x] 建立 `web/`（Vite + Vue 3 + TS + Pinia + Vitest）
- [ ] 建立 `tools/DejaTrade.DataTool` 與 `tests/`
- [x] 設定 `.gitignore`（`data-cache/`、`node_modules/`、`bin/obj`）
- [ ] 基本 CI（建置與測試）

### Phase 1：最小可行版本（約 1–2 個週末）
- [ ] DataTool：Binance BTC / ETH 1 分鐘 K 線抓取 → LiteDB → 匯出 JSON（約 100 天樣本）
- [x] 引擎：隨機抽日、逐根播放、市價買賣、損益結算 + 單元測試（含做空、槓桿、爆倉、每日挑戰種子）
- [x] 前端：Lightweight Charts 顯示 K 線、買賣按鈕、結算與揭曉畫面（雛型，用合成資料）
- [ ] 部署到靜態託管，取得可分享網址

### Phase 2：遊戲化
- [ ] 去識別化完整流程、局後揭曉
- [ ] 每日挑戰（日期種子）
- [ ] 戰績與統計（IndexedDB）、成就

### Phase 3：外匯
- [x] Node 腳本 `fetch:fx` 從 Dukascopy 抓 EURUSD / GBPUSD / USDJPY 1m（避開週末，預設週一至週四）；C# DataTool 之後補
- [x] 手續費 / 點差模型區分資產類別（FX：無手續費、點差以 pip、槓桿 10/30/100x、手數與 pip 顯示）
- [ ] 實機驗證 `fetch:fx`（沙箱連不上 Dukascopy，尚未對真實網路跑過）

### Phase 4：Arcade 與小遊戲
- [ ] 首頁改為遊戲廳結構
- [ ] 實作 1–2 個小遊戲（猜漲跌、爆倉前平倉）

### Phase 5：作品集打磨
- [ ] README：截圖、示範動畫、架構圖
- [ ] 開發筆記：資料取得、去識別化、tick 模擬、授權考量的取捨
- [ ] zh-TW 介面、響應式、效能檢查

### Phase 6（選配）
- [ ] 美股（先確認 Alpaca 免費方案可回溯的分鐘線範圍）、台股

### MVP 完成標準
- 網址打開即可玩一局完整的 BTC 當沖，結算後揭曉標的與日期。
- 引擎有單元測試；CI 綠燈；README 有截圖與說明。

---

## 7.1 目前進度（2026-10-02）

- `web/` 雛型可玩：選槓桿 → 隨機一局／今日挑戰 → 逐 tick 播放 → 買賣／平倉 → 結算並揭曉。
- 資料暫用 `npm run gen:sample` 產生的**合成資料**（`meta.synthetic = true`），格式與 4.4 相同，之後由 C# DataTool 的真實輸出直接取代。
- **尚未開始**：`tools/DejaTrade.DataTool`、`tests/`（開發機尚未安裝 dotnet；雛型期間的沙箱也連不上 Binance，需在自己的機器上抓資料）、CI、部署、IndexedDB 存檔。

## 8. 決策紀錄

| 日期 | 決策 | 原因 / 備註 |
|---|---|---|
| 2026-10-02 | 做成網頁版 | 免安裝、點連結即玩，最利於作品集 |
| 2026-10-02 | 前端用 Vue 3 + TS，不改 React | 使用者熟 Vue；面試看專案完整度而非框架；除非目標職缺明確要求 React |
| 2026-10-02 | **採方案 A**：靜態網頁 + C# 資料工具（LiteDB 當本機快取） | 兼顧「易於遊玩」與「展示 .NET 能力」；單機、不複雜 |
| 2026-10-02 | 不做後端伺服器、SignalR、Redis、伺服器權威判定、線上排行榜 | 單機遊戲作弊只影響自己；降低複雜度 |
| 2026-10-02 | 遊戲引擎留在前端（TS） | 單機無需伺服器；引擎與 UI 分離並加測試 |
| 2026-10-02 | 雛型先以合成資料跑通前端與引擎；DataTool 之後補 | 先驗證玩法，再接真實資料 |
| 2026-10-02 | 雛型階段改用 Node 腳本 `fetch:binance` 抓 BTC/ETH/SOL 真實資料；`public/data/` 不進版控 | 免裝 dotnet 就有真實資料；授權未確認前不公開散布。C# DataTool 之後補，輸出格式不變 |
| 2026-10-02 | 資料順序：加密貨幣 → 外匯 → 股票 | 資料取得難度與授權清晰度由易到難 |
| 2026-10-05 | 外匯資料採 Dukascopy（取代 HistData，因 HistData 僅 1m 且操作空間小）；僅供個人練習 | Dukascopy 條款為個人非商業用途；資料只放本機（`web/public/data/`、`.dukascopy-cache` 不進版控），**不可公開部署**，若要上線需另行取得授權或改用自行產生的資料 |
| 2026-10-05 | 成本模型依資產類別區分；FX 用手數（1 lot = 100,000 基礎貨幣）與 pip，槓桿 10/30/100x（預設 30x），維持保證金 = 0.5/槓桿 | 貼近真實外匯下單；加密貨幣維持原 taker/maker 手續費模型 |
| 2026-10-05 | 各 fetch 腳本只取代自己資產類別的題庫與索引 | 避免抓外匯時蓋掉加密貨幣資料 |
| 2026-10-05 | 先做網頁版（GitHub Pages，Actions 自動部署）；公開站加密貨幣由訪客瀏覽器即時向 Binance `data-api.binance.vision` 抓取，外匯只放合成資料 | 資料授權限制不能附帶真實資料；Actions 內有檢查擋掉非合成外匯檔。桌面版（Electron，程式內下載題庫）列為之後選項 |

**曾評估但未採用**：方案 B（Avalonia / WPF 桌面 App + LiteDB，全 .NET 但需下載才能玩）、方案 C（本機 ASP.NET Core 打包 Vue）、方案 D（純前端、不用 .NET）。若之後想強化 .NET 展示，可回頭評估 B。

## 9. 待決事項

- [ ] 最終專案名稱（目前資料夾為 DejaTrade）
- [ ] 各資產類別釋出的樣本交易日數量
- [ ] 品質篩選門檻（缺漏率、最低成交量、最小波動）
- [ ] 是否使用 UI 元件庫（或自行寫樣式）
- [ ] 各資料來源使用條款的確認結果
- [ ] Alpaca 免費方案分鐘線的實際可回溯範圍

## 10. 參考資料

- [binance/binance-public-data](https://github.com/binance/binance-public-data)
- [dukascopy-node](https://www.dukascopy-node.app/)
- [Polygon 與 Alpaca 資料方案比較](https://alpaca.markets/learn/the-top-3-differences-between-polygon-and-alpaca-data-plans)
- [FinMind 技術面資料](https://finmind.github.io/tutor/TaiwanMarket/Technical/)
- 既有類似產品：[ChartMini](https://chartmini.com/market-replay)、[ReplayTrader](https://replaytrader.app/)、[FX Replay](https://fxreplay.com/)、[Forex Tester](https://forextester.com/)、[simul8or](https://simul8or.com/TradingGameLanding.php)、[Tradicted](https://www.tradicted.com/tools/day-trading-simulator/)
