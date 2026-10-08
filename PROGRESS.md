# 開發進度

給接手這個專案的開發者或 agent。需求與決策的完整內容在 `private/portfolio_management_spec.md`（私人文件，不進版本庫；找不到時向專案擁有者索取）。每次完成或變更工作，都要更新這份文件。

最後更新：2026-10-09

## 現況

| 階段 | 範圍 | 狀態 |
|---|---|---|
| P0-A | 商品登錄、機構與帳戶、交易、持倉、現金、資金流 | 完成 |
| P0-B | NAV、帶符號指數曝險、Gross/Net 槓桿、每日快照 | 完成 |
| P0-C | 目標配置、新資金分配、信貸與質押帳務 | 完成 |
| 基礎建設 | Node 本機後端、GAS + Sheets 後端、報價代理、隱私檢查 | 完成（GAS 未在真實環境驗證） |
| 介面 | 明亮／黑色模式、中文字型後備、多機構與手續費設定 | 完成 |
| 會員 | 註冊、登入（密碼 + Google）、管理、資料隔離 | 進行中 |
| P1-A | Strategy Registry、Trade Journal、策略資金帳本、輪動週期 | 進行中 |
| P1-B | TWR、XIRR、基準比較、主被動四層級 | 進行中 |
| P1-C | 兩種風險模擬、期貨轉倉、通知 | 進行中 |
| P2 | 商品替代比較、歷史進階分析、券商唯讀同步 | 未開始 |
| Future | 選擇權多腿與 Greeks、半自動與自動轉倉 | 未開始 |

## 怎麼開始

```bash
export PATH=$HOME/miniconda3/envs/agent/bin:$PATH   # 這台機器的 Node 不在預設 PATH
npm install
npm run dev              # http://127.0.0.1:5173
npm test && npm run typecheck && npm run build && npm run check:privacy
```

四個指令全過才算完成。先讀 `SPEC.md`（驗收條件與共用檔案規則）、`README.md`（架構）、`docs/PRIVACY.md`。

## 架構重點

- `src/core/`：純函式計算引擎，每個模組都有 `tests/` 下的對應測試。
  - `types.ts` 資料模型；`ledger.ts` 交易重播成持倉、現金、貸款餘額；`valuation.ts` NAV、曝險、槓桿。
  - `allocation.ts` 目標配置與交易建議；`loans.ts` 攤還、質押、債務現金流；`fees.ts` 手續費估算。
  - `snapshots.ts`、`alerts.ts`、`csv.ts`、`backup.ts`、`accountsView.ts`。
  - `api.ts` 前後端協定；`seed.ts` 公開商品、指數與常用機構清單。
- `src/web/`：React。頁面只透過 `store.ts`（`useData`、`upsertRow`、`removeRow`、`setTable`）讀寫資料，用 `usePortfolio()` 取得帳本與估值。
- `server/`：Node 後端。`gas/`：GAS 後端。兩者實作同一個協定，改協定時兩邊都要改，`tests/gas.test.ts` 會檢查資料表清單一致。

## 設計決策

- **曝險口徑**：帶符號數量 × 價格 × 契約乘數 × 每日目標槓桿 × 匯率，以目前 NAV 為分母。
- **期貨**：不計市值；未實現損益計入資產，已實現損益結算到現金。保證金是現金，不是曝險，也不是負債。
- **負債**：貸款餘額加上為負的現金餘額。
- **還款來源**：外部資金還款計入累積投入並提高 NAV；組合內資金還款不改變 NAV。
- **不強制槓桿上限**：門檻只產生提醒。
- **空頭部位**：被動核心的建議不建立空頭；使用者自建的空頭計入 Gross/Net。
- **機構**：不預設任何券商或帳戶；資料表仍叫 `brokers`，以 `kind` 區分券商、銀行、交易所。
- **手續費**：依機構與商品類別的費率、折讓、最低費用與交易稅估算；實際金額以交易記錄為準。
- **GAS 儲存**：每列完整內容存在 `_json` 欄，其餘欄位只是鏡像。
- **價格歷史**：`priceHistory` 表存每日收盤與還原收盤；估值用收盤，基準報酬用還原收盤。
- **貸款剩餘期數**：依日期計算，餘額重新攤到剩餘期數。

## 已知限制

- GAS 後端只在模擬的 Apps Script 服務上測過。
- 報價來源是 Yahoo Finance、Binance 與期交所行情資訊網的公開端點，非授權行情，可能延遲或限流。台灣期貨取近月契約，含夜盤。
- 頁面互動只做過部分瀏覽器實測（主題切換、機構表單、交易表單開啟）；CSV 匯入、備份還原、貸款表單尚未逐一點過。
- 交易建議的手續費只估證券；期貨不估手續費，且缺保證金設定時成本以 0 計。

## 分工方式

- `main` 由專案擁有者或其授權的 agent 維護。其他工作在 task clone（`research task new exfolio <task>`，分支 `agent/<task>`）進行，完成後合併回 `main`。
- task clone 需要 `private/portfolio_management_spec.md` 時，由建立 task 的人手動複製進去；不可提交。
- 共用檔案（`types.ts`、`store.ts`、`backend.ts`、`api.ts`、`App.tsx`、`components/ui.tsx`、`styles.css`）的修改要先協調，避免平行任務衝突。

## 隱私規則

- 個人財務資料、金鑰、後端網址與 token、規格文件都不進版本庫。
- 測試與範例只用虛構數字，機構名稱用「示範券商甲」這類虛構名稱。
- 提交者信箱使用 GitHub noreply；`npm run check:privacy` 會檢查。
