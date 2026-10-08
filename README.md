# Exfolio

以淨資產（NAV）為分母、以實際市場曝險為核心的個人資產配置網站。產品規格是私人文件，放在不進版本庫的 `private/portfolio_management_spec.md`。

## 本機執行

需要 Node.js 20 以上。

```bash
npm install
npm run dev        # http://127.0.0.1:5173，前端與本機後端同一個程序
```

資料存在 `data/exfolio.json`（已被 git 忽略）。

```bash
npm test               # 計算引擎單元測試
npm run typecheck
npm run build          # 產生可部署到 GitHub Pages 的 dist/
npm run serve          # 以 Node 提供 dist/ 與 API：http://127.0.0.1:8787
npm run check:privacy  # 檢查版本庫內沒有個人資料或金鑰
```

## 架構

```
src/core/   純 TypeScript 計算引擎：帳本、估值、曝險、槓桿。不依賴 UI 或後端。
src/web/    React 前端。頁面在 pages/，共用元件在 components/。
server/     本機 Node 後端：JSON 檔儲存與報價代理。
gas/        Google Apps Script 後端：與 server/ 相同的 API，資料存在 Google Sheets。
tests/      Vitest 測試。
```

後端只負責儲存與報價，所有計算都在 `src/core/`。兩個後端使用同一個協定（[src/core/api.ts](src/core/api.ts)）：對單一網址 POST 一個帶 `action` 的 JSON。前端依序嘗試設定的後端，都連不上時改用瀏覽器 localStorage。

## 帳務口徑

- NAV = 證券市值 + 現金 + 期貨未實現損益 − 負債。
- 曝險 = 帶符號數量 × 價格 × 契約乘數 × 每日目標槓桿 × 匯率。
- 期貨保證金是帳戶內的現金，不是曝險，也不是負債。
- 外部投入與外部資金還款計入累積投入；帳戶間轉帳與換匯不計。

## 報價

Yahoo Finance 與 Binance 的公開端點，由後端代為請求。兩者都不是授權的即時行情來源：價格可能延遲，端點可能變動或限流。台灣期貨目前需手動輸入價格。

## 隱私

哪些內容可以進版本庫、哪些不行，見 [docs/PRIVACY.md](docs/PRIVACY.md)。
