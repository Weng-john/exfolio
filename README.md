# Exfolio

以淨資產（NAV）為分母、以實際市場曝險為核心的個人資產配置網站。產品規格是私人文件，放在不進版本庫的 `private/portfolio_management_spec.md`。

## 本機執行

需要 Node.js 20 以上。

```bash
npm install
npm run dev        # http://127.0.0.1:5173，前端與本機後端同一個程序
```

第一次開啟會看到虛構的示範資料；按「登入 / 註冊」建立帳號，第一個帳號會成為管理員。資料存在 `data/`（已被 git 忽略），每位會員一個檔案。只在自己的電腦上單人使用時，可用 `EXFOLIO_AUTH=off npm run dev` 關閉登入。

```bash
npm test               # 計算引擎單元測試
npm run typecheck
npm run build          # 產生可部署到 GitHub Pages 的 dist/
npm run serve          # 以 Node 提供 dist/ 與 API：http://127.0.0.1:8787
npm run check:privacy  # 檢查版本庫內沒有個人資料或金鑰
```

## 兩種版本

| | 公開版 | 完整版 |
|---|---|---|
| 用途 | 放在 GitHub Pages 的靜態網站 | 在自己的機器上搭配後端使用 |
| 後端與帳號 | 沒有 | Node 或 GAS 後端，會員登入 |
| 資料存放 | 只在使用者自己的瀏覽器 | 後端 |
| 頁面 | Overview、Core Allocation、New Money Allocator、Accounts & Positions、Loans & Collateral、Risk Lab、Settings | 全部 |
| 報價 | 定時產生的公開報價快照；Binance 由瀏覽器直接查詢 | 後端代理，每 30 秒更新 |
| 建置 | `npm run build:public` | `npm run build` |

公開版聚焦在三件事：計算目前的配置、評估風險、計算新資金怎麼投入。會員系統、策略、績效、期貨轉倉與交易所同步的程式碼都還在，只是公開版不提供。

公開版由 `.github/workflows/pages.yml` 建置與發布：推送到 `main` 時、以及每 30 分鐘（更新報價快照）各執行一次。要啟用網站，到儲存庫的 Settings → Pages，把來源設為 GitHub Actions。

公開版沒有帳號，資料會留在瀏覽器裡，下次開啟仍在。要搬到另一個瀏覽器或裝置，用 Settings → 後端與資料的匯出備份與還原。同一個地方可以用密碼加密存在瀏覽器裡的資料；風險說明見 [docs/PRIVACY.md](docs/PRIVACY.md)。

本機後端只回應來自本機網址的請求（`localhost`、`127.0.0.1`），其他網站的網頁無法呼叫它。要用別的主機名稱連線，設定 `EXFOLIO_ALLOWED_HOSTS`（見 `.env.example`）。

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

Yahoo Finance、Binance 與期交所行情資訊網的公開端點，由後端代為請求。三者都不是授權的即時行情來源：價格可能延遲，端點可能變動或限流。台灣期貨（TX、MTX、TMF）取近月契約，含夜盤。

## 隱私

哪些內容可以進版本庫、哪些不行，見 [docs/PRIVACY.md](docs/PRIVACY.md)。
