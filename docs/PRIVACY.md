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
npm run check:privacy
```

`npm install` 會把 git hook 路徑設成 `.githooks/`，之後每次 `git commit` 都會先對暫存檔跑同一個檢查。它會擋下：

- 上表「不可以同步」的路徑；
- 不在 `tests/fixtures/` 的 CSV；
- GAS 部署網址、Google Sheets 網址、私鑰、寫死的金鑰、疑似身分證字號、個人電子郵件。

檢查是輔助，不是保證：它認不出寫在程式碼或文件裡的實際金額與持股數。

## 寫程式與文件時

- 範例、測試、截圖一律用虛構數字。
- 不要把自己的實際持倉寫成預設值或種子資料。
- 網站部署到 GitHub Pages 的只有程式碼；資料在執行時才從你自己的後端讀取。

## 提交者身分

這個儲存庫的 git 設定使用 GitHub 的 noreply 信箱，提交紀錄不帶個人信箱。在別台機器複製後，請先設定：

```bash
git config user.email "<你的 GitHub 帳號>@users.noreply.github.com"
```

預設資料不含任何券商或帳戶：使用者自己從常用清單挑選或手動新增，所以程式碼不會透露你用哪幾家。
