# 隱私與版本控制

這個專案的程式碼可以公開，個人財務資料與金鑰不行。兩者在檔案層級就分開存放。

## 可以同步到 GitHub

| 內容 | 位置 |
|---|---|
| 前端、計算引擎、本機後端程式碼 | `src/`、`server/` |
| GAS 後端程式碼與部署說明 | `gas/`（不含部署網址與 token） |
| 測試與虛構測試資料 | `tests/`、`tests/fixtures/` |
| 公開商品與指數的參考資料 | `src/core/seed.ts` |
| 設定與文件 | `package.json`、`vite.config.ts`、`docs/`、`.env.example` |

## 不可以同步到 GitHub

| 內容 | 位置 | 保護方式 |
|---|---|---|
| 持倉、現金、交易、貸款等個人資料 | `data/exfolio.json` | `.gitignore`；可用 `EXFOLIO_DATA_DIR` 移到專案資料夾外 |
| 備份與匯出檔 | `backups/`、`exports/`、`*backup*.json` | `.gitignore` |
| 券商對帳單、要匯入的 CSV | `imports/`、`statements/`、`*.csv`、`*.xlsx`、`*.pdf` | `.gitignore` |
| GAS 部署網址與存取 token | 瀏覽器 localStorage、GAS 指令碼屬性 | 不寫入任何檔案 |
| Google 帳號與指令碼連結 | `.clasp.json`、`.clasprc.json` | `.gitignore` |
| 環境變數與金鑰檔 | `.env*`、`*.pem`、`*.key`、`credentials*.json` | `.gitignore` |
| 私人筆記 | `private/`、`*.private.md` | `.gitignore` |

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

## 公開前請自行決定的兩件事

- `portfolio_management_spec.md` 沒有金額或帳號，但描述了使用的券商、借款與質押的做法。若不想公開，請保持儲存庫為私有，或在公開前移除該檔。
- git 提交紀錄會帶有提交者的姓名與電子郵件。若不想公開信箱，可在 GitHub 設定使用 `noreply` 信箱後再推送。
