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
| 後端網址與登入 session | 瀏覽器 localStorage | 不寫入任何檔案 |
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

公開版（GitHub Pages）沒有後端，也沒有帳號：

- 使用者輸入的資料存在自己瀏覽器的 localStorage，網站不會上傳。
- 網站只會連到兩個地方：本站的報價快照（`quotes.json`），以及 Binance 的公開價格（只有啟用 Binance 報價的商品時；Binance 會看到查詢的交易對代號與使用者的 IP）。內容安全政策（CSP）禁止連到其他主機。
- 對帳單截圖的文字辨識引擎與語言資料由本站提供，不從 CDN 載入。

存在瀏覽器裡的資料，未加密時下列對象讀得到：共用同一個瀏覽器設定檔的人、有權讀取網頁的擴充套件，以及**同一個網址來源下的其他網頁**。GitHub Pages 上，同一個帳號的所有專案網站共用 `<帳號>.github.io` 這個來源。

Settings →「後端與資料」可以用密碼加密這份資料（AES-GCM，金鑰只留在分頁記憶體），也可以一鍵清除。加密擋不住已經在網站本身執行的惡意程式；匯出的備份檔是未加密的。

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
