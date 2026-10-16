# 隱私與版本控制

這個專案的程式碼可以公開，個人財務資料與金鑰不行。兩者在檔案層級就分開存放。

## 可以同步到 GitHub

| 內容 | 位置 |
|---|---|
| 前端、計算引擎、本機後端程式碼 | `src/`、`server/` |
| GAS 後端程式碼與部署說明 | `gas/`（不含部署網址與任何帳號資料） |
| 測試與虛構測試資料 | `tests/`、`tests/fixtures/` |
| 公開商品、指數與常見金融機構的參考資料 | `src/core/seed.ts` |
| 設定與文件 | `package.json`、`vite.config.ts`、`docs/`、`.env.example` |

## 不可以同步到 GitHub

| 內容 | 位置 | 保護方式 |
|---|---|---|
| 持倉、現金、交易、貸款等個人資料 | `data/exfolio.json` | `.gitignore`；可用 `EXFOLIO_DATA_DIR` 移到專案資料夾外 |
| 備份與匯出檔 | `backups/`、`exports/`、`*backup*.json` | `.gitignore` |
| 券商對帳單、要匯入的 CSV | `imports/`、`statements/`、`*.csv`、`*.xlsx`、`*.pdf` | `.gitignore` |
| 後端網址與登入 session | 完整版：瀏覽器 localStorage；公開版：只在分頁記憶體（GAS 網址在建置時帶入） | 不寫入任何檔案 |
| 會員帳號、密碼雜湊、稽核紀錄 | `data/auth.json`、`data/users/`，或 GAS 的控制試算表 | `.gitignore`；不在這個資料夾內 |
| Google 帳號與指令碼連結 | `.clasp.json`、`.clasprc.json` | `.gitignore` |
| 環境變數與金鑰檔 | `.env*`、`*.pem`、`*.key`、`credentials*.json` | `.gitignore` |
| 產品規格與私人筆記 | `private/`、`*.private.md` | `.gitignore` |

Google Sheets 本身存在你的 Google 帳號裡，從來不在這個資料夾內。

## 提交前檢查

```bash
npm run check:privacy              # 目前所有已追蹤的檔案
npm run check:privacy -- --history # 每一筆提交裡的每一個檔案，以及提交者身分與訊息
```

`npm install` 會把 git hook 路徑設成 `.githooks/`，之後每次 `git commit` 都會先檢查暫存的內容；發布流程在建置前會跑 `--history`。它會擋下：

- 上表「不可以同步」的路徑，以及金鑰檔、資料庫檔、壓縮檔、對帳單常見格式（PDF、Excel、OFX、QFX 等）。
- 不在 `tests/fixtures/` 的表格與圖片（CSV、TSV、PNG、JPEG 等）。
- 不在允許清單內的檔案類型。
- GAS 部署網址、Google Sheets 網址、OAuth 用戶端 ID 與 secret、私鑰、常見雲端服務金鑰、寫死的金鑰、疑似身分證字號與手機號碼、個人電子郵件、本機家目錄路徑。UTF-16 的文字檔也會檢查。

**這是安全網，不是邊界。** 下列情況它擋不住：

- `git commit --no-verify`，或剛 clone 下來還沒跑過 `npm install` 的儲存庫。
- 它沒有規則的內容：寫在程式碼或文件裡的實際金額、持股數、帳務處理經過。
- 已經推上去的內容：之後刪除檔案，舊版本仍留在歷史裡。

所以真正的保護是把個人資料放在被忽略的資料夾，而不是靠檢查。

## 公開版使用者的資料

公開版（GitHub Pages）有兩種用法。

**試算模式（不登入）**

- 輸入的資料只在這個分頁的記憶體裡，網站不會上傳，也不會存進瀏覽器；關閉或重新整理分頁就消失。想留下來，自己匯出備份檔（未加密）。
- 舊版網站曾把資料加密存在瀏覽器（localStorage）。若瀏覽器裡還有，網站會提示，可以輸入當初的密碼打開並帶進試算模式，或刪除。網站不再寫入新的瀏覽器資料。

**會員（Google 登入）**

- 會員資料存在網站管理員部署的 Google Apps Script 後端，寫進管理員 Google Drive 裡的試算表，每位會員一份。**管理員（部署者）可以直接打開這些試算表**，網站上的「允許管理員檢視」設定約束不了這一點，必須如實告知會員。
- 只接受 Google 登入；每次登入都要先向後端取得一次性的 challenge（Google 會把它寫進 ID token 的 `nonce`），在別處截到或用過的 token 不能拿來登入。新會員要經管理員核准。
- 登入狀態（session token）只放在分頁記憶體裡，不寫進 localStorage。關閉或重新整理分頁、閒置 30 分鐘、或按登出，這個分頁就會忘記它；按登出還會在後端撤銷。**只是關閉分頁不會撤銷後端的 session**：若 token 已被竊，在後端到期前（預設 12 小時）仍可使用。每位會員最多同時 5 個 session，超過時最舊的失效。
- 登出前會先把變更存進帳號；存不進去時會詢問是否捨棄。
- 登入前在試算模式輸入的資料：帳號是空的會直接存入；帳號已有資料時，由會員選擇取代或捨棄。
- GAS 網址由 GitHub repository variable `EXFOLIO_GAS_URL` 在建置時帶入，不進版本庫；但它必然出現在建置出的網站程式碼裡，不是秘密。前端只接受 `https://script.google.com/macros/s/…/exec` 形式的網址。

**網站會連到哪裡**（內容安全政策 CSP 只允許這些）

- 本站自己的檔案，包含報價快照（`quotes.json`）與文字辨識引擎。
- Binance 的公開價格，只在有啟用 Binance 報價的商品時；Binance 會看到查詢的交易對代號與使用者的 IP。
- 有會員功能時：Google 登入元件（`accounts.google.com/gsi/`），以及 GAS 後端（CSP 只允許那一個 `/exec` 網址；回應經由 `script.googleusercontent.com`，這是所有 Apps Script 共用的主機，CSP 無法再收窄，所以理論上已在頁面執行的惡意程式可以把資料送到別人的 Apps Script）。只有按下「會員登入」才會載入 Google 的元件。
- 對帳單截圖的辨識在瀏覽器內的 worker 執行，同樣受 CSP 限制，不從 CDN 載入任何東西。

**同來源的限制**

GitHub Pages 上，同一個帳號的所有專案網站共用 `<帳號>.github.io` 這個來源。同來源的其他網頁若被植入惡意程式，可以開啟或操作本站的分頁、讀取畫面、攔截輸入與送出的請求（包含 session token）；CSP 只管本站自己的網頁。被攔下的 token 在後端到期前都能用，被帶走的資料也不會因為關閉分頁而消失。不在瀏覽器裡存放資料或 session，只是讓「事後從瀏覽器讀出來」不可能，並不能把本站和同來源的其他網頁隔開。**要真正隔離，網站必須放在獨立的來源**（自訂網域，或只放這一個網站的 GitHub 帳號／組織），OAuth 的已授權來源也要跟著改。在那之前，會員資料應視為與同帳號其他 Pages 網站的安全性綁在一起。

另外有兩個小設定會存在瀏覽器：顯示主題，以及商品替代比較的假設參數（融資利率、波動率等，不含持倉）。對帳單截圖的辨識引擎會把語言資料快取在 IndexedDB（不含截圖或辨識結果）。「刪除舊資料」會清除本站在 localStorage 的全部項目（含主題與上述假設），但不會清掉已經帶進試算模式、還在記憶體裡的資料。

## 寫程式與文件時

- `PROGRESS.md`、`README.md` 與提交訊息都是公開的：只寫程式與設計，不寫任何人的帳務處理經過、匯入了哪家機構的資料、還缺哪些個人資料。這類紀錄放在 `private/`。
- 範例、測試、截圖一律用虛構數字。
- 不要把自己的實際持倉寫成預設值或種子資料。
- 網站部署到 GitHub Pages 的只有程式碼；資料在執行時才從你自己的後端讀取。

## 提交者身分

這個儲存庫的 git 設定使用 GitHub 的 noreply 信箱，提交紀錄不帶個人信箱。在別台機器複製後，請先設定：

```bash
git config user.email "<你的 GitHub 帳號>@users.noreply.github.com"
```

預設資料不含任何券商或帳戶：使用者自己從常用清單挑選或手動新增，所以程式碼不會透露你用哪幾家。
