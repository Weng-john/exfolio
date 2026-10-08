# GAS + Google Sheets 後端

`Code.gs` 實作與本機 Node 後端相同的 API，資料存在你自己的 Google 試算表。前端部署到 GitHub Pages 後，在 Settings 填入這個後端的網址與 token 即可使用。

> 這份程式碼只在本機以模擬的 Apps Script 服務測試過（`tests/gas.test.ts`），尚未在真實的 Google 環境執行。第一次部署後請照最後一節驗證。

## 部署步驟

1. 在 Google Drive 建立一個新的試算表，名稱自訂。保持「限制存取」，不要開放連結分享。
2. 在試算表選「擴充功能 → Apps Script」。
3. 把編輯器裡的 `Code.gs` 內容換成本資料夾的 [Code.gs](Code.gs)。
4. 「專案設定」勾選「在編輯器中顯示 appsscript.json 資訊清單檔案」，再把內容換成本資料夾的 [appsscript.json](appsscript.json)。
5. 在編輯器上方選函式 `setupToken` 後按「執行」，依提示授權。開啟「執行記錄」，複製印出的 `EXFOLIO_TOKEN`。
6. 選函式 `setupSheets` 後按「執行」，試算表會出現各資料表的工作表。
7. 「部署 → 新增部署作業 → 網頁應用程式」：執行身分選「我」，存取權選「所有人」。部署後複製網頁應用程式網址（結尾是 `/exec`）。
8. 開啟 Exfolio 網站，到 Settings → 後端與資料：模式選「遠端」，貼上網址與 token，按「測試連線」。

之後修改 `Code.gs` 要到「部署 → 管理部署作業」編輯並選「新版本」，網址才會套用新程式碼。

## 網址與 token 的保管

- 兩者都只存在瀏覽器的 localStorage 和 GAS 的指令碼屬性，**不要寫進任何會提交的檔案**。`npm run check:privacy` 會擋下 GAS 網址。
- token 外洩時，重新執行 `setupToken` 產生新的，並在網站上更新。
- 換裝置時，在新裝置的 Settings 重新填一次。

## 安全性：你應該知道的限制

存取權設成「所有人」是必要的，否則從 GitHub Pages 發出的請求過不了 Google 登入。因此這個網址本身是公開可呼叫的，保護完全靠 token：

- 沒有設定 `EXFOLIO_TOKEN` 時，後端拒絕所有請求。
- token 錯誤 10 次後鎖定約 10 分鐘。這也表示知道網址的人可以讓你暫時無法使用。
- 任何拿到網址和 token 的人，都能讀寫你的全部資料。
- 這是單一使用者的設計：沒有使用者帳號，也沒有資料隔離。要開放多人使用，需要換成有正式身分驗證的後端。
- 指令碼以你的身分執行，權限限於試算表與對外抓取報價。它不持有任何券商或交易所的金鑰，也不能下單。

## 試算表結構

每個資料表一個工作表（`brokers`、`accounts`、`indices`、`instruments`、`transactions`、`loans`、`prices`、`fxRates`、`targets`、`strategies`、`snapshots`、`settings`），加上記錄版本號的 `_meta`。

每一列的完整內容以 JSON 存在最後一欄 `_json`，這是唯一的資料來源。其他欄位只是方便閱讀的鏡像，每次儲存都會重寫：

- 直接改一般欄位**不會生效**，下次儲存就被覆蓋。
- 要手動修資料，請改 `_json` 欄，或用網站的備份與還原。

所有儲存格都是純文字格式，避免 Sheets 把 `0050` 變成 `50`、把日期字串變成日期。

## 報價

GAS 端用 `UrlFetchApp` 抓 Yahoo Finance 與 Binance 的公開端點，快取 20 秒。兩者都不是授權行情：可能延遲、限流或變更。Apps Script 每日有對外請求配額；頁面開著時每 30 秒更新一次，長時間開著可能用完配額，屆時報價會停更但資料讀寫不受影響。

## 部署後驗證

1. Settings 的「測試連線」顯示成功。
2. 新增一筆交易，在試算表的 `transactions` 工作表看到該列。
3. 重新整理網頁，資料仍在。
4. 把 token 改成錯的，確認網站顯示同步失敗且讀不到資料。
5. 按「更新報價」，確認價格與時間有更新。
