# 開發進度

給接手這個專案的開發者或 agent。需求與決策的完整內容在 `private/portfolio_management_spec.md`（私人文件，不進版本庫；找不到時向專案擁有者索取）。每次完成或變更工作，都要更新這份文件。

最後更新：2026-10-09

## 帳本擴充（2026-10-09）

- `position_transfer`：同一策略桶的現貨跨帳戶移轉，保留 FIFO 成本與原買入日期，不改現金、NAV、曝險或已實現損益；帳本、交易日誌、CSV 與表單皆支援。
- `loan_accrual` 與 `loan_extension`：未付利息增加負債與融資成本，付款時避免重複認列；展延只記錄條件，不視為新撥款。貸款頁顯示未付利息與展延紀錄。
- 還款資金來源可標記 `unconfirmed`：在交易與貸款頁標示，確認前不計入現金、負債、投入本金或績效。
- 推估的資金流（日期、金額或匯率為估計值）在 Overview、Performance 與交易頁有標示；編輯交易時可標記為已依銀行流水核對。
- 與特定帳戶有關的匯入紀錄、對帳過程與待補事項屬於個人資料，記在 git 忽略的 `private/`，不寫進這份文件。

## 現況

| 階段 | 範圍 | 狀態 |
|---|---|---|
| P0-A | 商品登錄、機構與帳戶、交易、持倉、現金、資金流 | 完成 |
| P0-B | NAV、帶符號指數曝險、Gross/Net 槓桿、每日快照 | 完成 |
| P0-C | 目標配置、新資金分配、信貸與質押帳務 | 完成 |
| 基礎建設 | Node 本機後端、GAS + Sheets 後端、報價代理、隱私檢查 | 完成（GAS 未在真實環境驗證） |
| 介面 | 明亮／黑色模式、中文字型後備、多機構與手續費設定 | 完成 |
| 會員 | 註冊、登入（密碼 + Google）、管理、資料隔離、訪客預覽 | 完成（GAS 版未在真實環境驗證） |
| P1-A | Strategy Registry、Trade Journal、策略資金帳本、輪動週期 | 完成 |
| P1-B | TWR、XIRR、基準比較、主被動四層級 | 完成（核心被動層級尚無基準） |
| P1-C | 兩種風險模擬、期貨轉倉、通知 | 完成 |
| 公開版 | 無後端、無帳號的靜態版本（配置、風險、再投入），GitHub Pages 發布流程 | 完成；Pages 尚未啟用 |
| P2 | 商品替代比較、歷史進階分析、券商唯讀同步 | 商品替代與歷史進階分析已完成；Binance 唯讀同步已實作（真實帳戶未驗證）。其他券商沒有可用的唯讀 API，改以對帳單匯入（CSV 或截圖） |
| Future | 選擇權多腿與 Greeks、半自動與自動轉倉 | 未開始 |

## 怎麼開始

```bash
export PATH=$HOME/miniconda3/envs/agent/bin:$PATH   # 這台機器的 Node 不在預設 PATH
npm install
npm run dev              # http://127.0.0.1:5173
npm test && npm run typecheck && npm run build && npm run check:privacy && npm run format:check
```

五個指令全過才算完成；提交前先跑 `npm run format`。先讀 `SPEC.md`（驗收條件與共用檔案規則）、`README.md`（架構）、`docs/PRIVACY.md`。

## 架構重點

- `src/core/`：純函式計算引擎，每個模組都有 `tests/` 下的對應測試。
  - `types.ts` 資料模型；`ledger.ts` 交易重播成持倉、現金、貸款餘額；`valuation.ts` NAV、曝險、槓桿。
  - `allocation.ts` 目標配置與交易建議；`loans.ts` 攤還、質押、債務現金流；`fees.ts` 手續費估算。
  - `stress.ts` 靜態壓力測試（對衝擊後的資料複本重跑 `computePortfolio`）；`survival.ts` 現金流生存模擬（逐日，`today` 由參數傳入）。
  - `snapshots.ts`、`alerts.ts`、`csv.ts`、`backup.ts`、`accountsView.ts`。
  - `strategies.ts` 四層級摘要、策略資金帳本、輪動週期報告；`journal.ts` 交易日誌、來回交易、統計。
  - `performance.ts` 歷史估值、TWR、MWR、基準、風險統計；`xirr.ts`。
  - `stress.ts` 靜態壓力測試；`survival.ts` 現金流生存模擬。
  - `futures.ts` 期貨部位、保證金、轉倉；`notifications.ts` 通知。
  - `dates.ts` 以 UTC 處理 `YYYY-MM-DD` 的日期運算（`daysBetween`、`addDays` 等），各模組共用，不再各自實作。
  - `demo.ts` 訪客預覽用的虛構資料。
  - `statementImport.ts` 對帳單解析、欄位對應、商品比對、防重複、影響預覽；`ocrTable.ts` 由辨識出的文字方塊重建表格。
  - `exchangeSync.ts` 交易所餘額核對與成交轉交易；`replacement.ts` 商品替代比較；`historyAnalytics.ts` 歷史分析。
  - `positionTransfer.ts` 跨帳戶移轉時搬移 FIFO 批次。
  - `indexMerge.ts` 把一個標的指數併入另一個（Settings → 標的指數 →「併入其他指數」）。
  - `api.ts` 前後端協定；`seed.ts` 公開商品、指數與常用機構清單。
- `src/web/`：React。頁面只透過 `store.ts`（`useData`、`upsertRow`、`removeRow`、`setTable`）讀寫資料，用 `usePortfolio()` 取得帳本與估值。
- `src/web/auth.ts` 管登入狀態；`App.tsx` 未登入時載入示範資料（`store.loadDemo()`），登入後才讀取會員自己的資料。
- `server/auth.ts`：會員、session、管理員操作與稽核；`server/handler.ts` 依登入狀態分派請求。
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
- **合併指數**：是使用者自己資料上的一次性操作，不是全域設定：商品、配置目標（權重相加）、策略基準與快照的分指數曝險都改掛到保留的指數，被合併的指數移除，無法自動復原。預設資料仍把加權指數與台灣 50 分開。
- **兩種版本**：`VITE_EXFOLIO_EDITION=public` 建置公開版（`src/web/edition.ts`）。公開版一律使用瀏覽器儲存、不連任何後端、不顯示會員與 `fullOnly` 的頁面；報價來自 `quotes.json` 快照（`scripts/fetch-quotes.mts`，只含預設商品與匯率）與瀏覽器直連 Binance。會員系統與其他頁面的程式碼保留，只是不上線。
- **瀏覽器內的資料**：`src/web/localVault.ts`。所有操作（讀、存、加密、鎖定、清除）排成單一序列，並以 Web Locks 跨分頁互斥；每個操作使用開始時的金鑰；已加密的紀錄絕不會被寫回明文；`save` 會比對版本，另一個分頁先存過就回報衝突。AES-GCM，PBKDF2 60 萬次，金鑰只在分頁記憶體。公開版一律加密：未設定密碼時停在 `pages/auth/SetupPage.tsx`，只能用示範資料預覽；完整版的瀏覽器儲存模式則是可選。閒置 20 分鐘自動鎖定。
- **儲存結果**：`store.flush()` 回傳是否全部存妥，並會等待進行中的儲存。鎖定、變更加密設定前都要先確認成功，失敗就不繼續，以免丟掉未儲存的變更。
- **本機後端的請求來源**：`server/handler.ts` 的 `refusal()` 只接受 Host 為本機名稱（或 `EXFOLIO_ALLOWED_HOSTS`）且來源為同一網站的請求，擋掉其他網站的跨站寫入與 DNS rebinding。
- **CSP**：建置時由 `vite.config.ts` 注入；公開版只允許本站與 Binance 公開價格，完整版另外允許 Google 登入與 HTTPS 後端。開發伺服器不套用。辨識 worker 由 blob 啟動，因此繼承這份政策（直接由網址載入的 worker 在靜態主機上不受任何政策約束）。
- **截圖辨識引擎**：由 `scripts/vendor-ocr.mjs` 從 node_modules 複製到 `public/vendor/ocr/`（被 git 忽略），網站自己提供，不從 CDN 載入。
- **公式注入**：匯出的 CSV 與 GAS 寫入試算表的鏡像欄及欄名，凡以 `= + - @`（含全形、前有空白）或 tab／換行開頭的文字都加上前置單引號。CSV 的規則可逆：只移除自己加上的單引號，使用者原本輸入的會保留。
- **會員**：每位會員一個資料檔（Node：`data/users/<id>.json`）。密碼先在瀏覽器以 PBKDF2 延展，後端再以 scrypt 加鹽雜湊；session token 只存雜湊，30 天有效。第一個帳號是管理員；之後預設需審核，可改為開放註冊。
- **管理員檢視**：由會員自己的 `allowAdminView` 決定（預設開啟），一律唯讀並寫入稽核紀錄。`save` 永遠只寫呼叫者自己的資料。
- **Google 登入**：不會因為名稱相同就併入既有帳號；要綁定必須先登入再綁。
- **訪客預覽**：未登入時顯示 `demoData()` 的虛構組合，可在記憶體中操作但不儲存；報價代理與資料 API 仍需登入。
- **單人模式**：`EXFOLIO_AUTH=off` 關閉登入，使用 `data/exfolio.json`，只適合自己的電腦。
- **策略桶**：桶權益 = 桶現金 + 證券市值 + 衍生品未實現損益；貸款歸屬於動用交易所在的桶；各桶淨權益合計等於 NAV。
- **TWR**：在每個外部資金流日期切段再連乘；日期型資金流視為當日收盤後發生；視窗早於第一筆資金時從第一筆資金起算。
- **歷史估值**：沒有歷史匯率，非本位幣一律用目前匯率；缺價會列出，不以成本或猜測替代。
- **台灣期貨報價**：`taifex` 來源，商品代碼取近月契約，日盤與夜盤取較新的一筆；逐一請求並快取 90 秒。

## 已知限制

- 發布前的資安覆核由另一個模型獨立進行過兩輪（報告不在版本庫內）。仍未處理的：GAS 的第一位管理員搶註與註冊濫用（見 `gas/README.md`）；登入節流可被用來鎖定特定帳號；備份還原只檢查大小與基本格式；公開版與同帳號其他 GitHub Pages 專案共用來源（以強制加密與說明緩解，沒有使用獨立網域，見 `docs/PRIVACY.md`）；報價快照以整體成功率把關，沒有逐商品的新鮮度門檻；GAS 的公式防護未在真實的 Google Sheets 上驗證。

- Risk Lab：兩種模擬皆為資訊用途，不限制操作。壓力測試是瞬間衝擊近似；生存模擬的市場路徑為線性或指定日期的單次衝擊，槓桿 ETF 以每日目標槓桿逐日複利（模型，非預測）。期貨／永續合約帳戶的現金只作保證金，不支付生活支出與還款。

- GAS 後端（含會員系統）只在模擬的 Apps Script 服務上測過；`gas/README.md` 有部署後的驗證清單。密碼雜湊輪數、`getUuid()` 的隨機性、Drive 權限範圍都需要在真實環境確認。
- 報價來源是 Yahoo Finance、Binance 與期交所行情資訊網的公開端點，非授權行情，可能延遲或限流。台灣期貨取近月契約，含夜盤。
- 頁面互動的瀏覽器實測涵蓋：全部頁面載入、主題切換、機構表單、會員流程（註冊、審核、登入、唯讀檢視、撤回同意、登出）、歷史價格下載。CSV 匯入、備份還原、貸款與轉倉表單尚未逐一點過。
- 期交所行情資訊網對連續請求很敏感，曾在測試中整站回應 HTTP 520；夜盤報價的選擇邏輯只有單元測試覆蓋。
- 績效：核心被動與整體組合層級沒有基準（策略才有）；台灣期貨沒有歷史價格來源，相關期間會列為缺價。
- Google 登入需要架設者提供 OAuth 用戶端 ID；綁定既有帳號與多會員情境尚未逐項實測。
- 對帳單匯入精靈已完成：CSV／TSV 與截圖兩種來源，欄位對應、設定檔（`importProfiles`）、逐列檢查、影響預覽、防重複。引擎在 `src/core/statementImport.ts`（表格重建在 `ocrTable.ts`），截圖辨識在 `src/web/ocr.ts`（tesseract.js，瀏覽器內執行）。瀏覽器實測涵蓋一份 CSV 與一張虛構截圖的完整五步流程；截圖辨識會看錯個別字，需人工核對。
- 精靈目前只產生一般交易類型；`position_transfer`、`loan_accrual`、`loan_extension` 不會從對帳單自動產生，需手動新增。
- `src/web/pages/Futures.tsx` 有多行過長、難以閱讀，功能正常但值得整理。
- 日期小工具（`daysBetween` 等）在數個核心模組各有一份，尚未合併。
- 交易建議的手續費只估證券；期貨不估手續費，且缺保證金設定時成本以 0 計。

## 分工方式

- `main` 由專案擁有者或其授權的 agent 維護。其他工作在 task clone（`research task new exfolio <task>`，分支 `agent/<task>`）進行，完成後合併回 `main`。
- task clone 需要 `private/portfolio_management_spec.md` 時，由建立 task 的人手動複製進去；不可提交。
- 兩種 worker 都用過：本 session 的子 agent（sonnet），以及沙箱啟動器的 codex worker（`agent --provider codex --model gpt-5.6-terra|gpt-5.6-luna --env exfolio exfolio <task>`）。
- 沙箱 worker 沒有網路：啟動前要先在 task clone 裡 `npm ci`，並把任務說明放在 clone 的 `private/TASK.md`（已被 git 忽略）。研究環境 `exfolio`（`~/conda_envs/research-exfolio`，含 Node 與 Python）已登記在控制平面的 `config/environment.conf`。
- 共用檔案（`types.ts`、`store.ts`、`backend.ts`、`api.ts`、`App.tsx`、`components/ui.tsx`、`styles.css`）的修改要先協調，避免平行任務衝突。

## 隱私規則

- 個人財務資料、金鑰、後端網址與 token、規格文件都不進版本庫。
- 測試與範例只用虛構數字，機構名稱用「示範券商甲」這類虛構名稱。
- 提交者信箱使用 GitHub noreply；`npm run check:privacy` 會檢查。
