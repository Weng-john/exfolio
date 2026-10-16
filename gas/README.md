# GAS + Google Sheets 後端

`Code.gs` 實作與本機 Node 後端相同的 API，包含會員系統（Google 登入、管理員審核、資料隔離），資料存在部署者的 Google 試算表。公開網站（GitHub Pages）的會員共用同一個部署；網站在建置時從 GitHub repository variable `EXFOLIO_GAS_URL` 取得它的網址。

> 這份程式碼只在本機以模擬的 Apps Script 服務測試過（`tests/gas.test.ts`），尚未在真實的 Google 環境執行。第一次部署後請照最後一節驗證。

## 部署步驟

1. 在 Google Drive 建立一個新的試算表，名稱自訂，當作「控制試算表」。保持「限制存取」，不要開放連結分享。
2. 在試算表選「擴充功能 → Apps Script」。
3. 把編輯器裡的 `Code.gs` 內容換成本資料夾的 [Code.gs](Code.gs)。
4. 「專案設定」勾選「在編輯器中顯示 appsscript.json 資訊清單檔案」，再把內容換成本資料夾的 [appsscript.json](appsscript.json)。
5. 「專案設定 → 指令碼屬性」新增：

   | 屬性 | 值 |
   |---|---|
   | `ADMIN_EMAILS` | 你的 Gmail（`@gmail.com`，多個用逗號分隔；其他網域會被忽略）。**還沒有任何啟用中的管理員時**，第一個用其中地址登入的 Google 帳號會成為管理員；之後這個屬性就不再授予權限，其他管理員請在會員管理頁指派。**一定要設**，並在公開網址前先登入一次。 |
   | `GOOGLE_CLIENT_ID` | OAuth 用戶端 ID（見「Google 登入」一節）。 |
   | `MAX_MEMBERS`（選填） | 會員總數上限，預設 200。 |
   | `MAX_PENDING`（選填） | 待審核人數上限，預設 30；滿了就暫停受理新申請。 |
   | `PASSWORD_LOGIN`（選填） | 設成 `on` 才開放帳號密碼註冊與登入（含管理員重設密碼）。預設關閉，只接受 Google 登入。 |
   | `SESSION_HOURS`（選填） | 登入有效時數。預設 12 小時（開啟密碼登入時為 30 天）。 |

6. 在編輯器上方選函式 `setupSheets` 後按「執行」，依提示授權（授權畫面會列出下一節的三個權限）。控制試算表會出現 `_users`、`_sessions`、`_config`、`_audit` 四個工作表。
7. 「部署 → 新增部署作業 → 網頁應用程式」：執行身分選「我」，存取權選「所有人」。部署後複製網頁應用程式網址（`https://script.google.com/macros/s/…/exec`）。
8. 公開網站：在 GitHub repo 的 Settings → Secrets and variables → Actions → Variables 新增 `EXFOLIO_GAS_URL`，值是上一步的網址，然後重新執行 Pages workflow。本機的完整版：在 Settings → 後端與資料選「遠端」並貼上網址。
9. 用 `ADMIN_EMAILS` 裡的 Google 帳號登入網站，確認你是管理員。其他人第一次用 Google 登入會成為「待核准」，在「會員管理」核准後才能使用。

之後修改 `Code.gs` 要到「部署 → 管理部署作業」編輯並選「新版本」，網址才會套用新程式碼。

## 要求的權限（scopes）

| Scope | 為什麼需要 |
|---|---|
| `https://www.googleapis.com/auth/spreadsheets` | 讀寫控制試算表，並用 `SpreadsheetApp.create` 替每位會員建立、開啟他們的試算表。 |
| `https://www.googleapis.com/auth/drive` | 只用在一件事：刪除會員時，用 `DriveApp.getFileById(id).setTrashed(true)` 把該會員的試算表丟進垃圾桶。Apps Script 沒有只靠試算表權限就能刪檔的方法。 |
| `https://www.googleapis.com/auth/script.external_request` | 抓報價（Yahoo Finance、Binance、期交所）與向 Google 驗證 ID token。 |

關於 `drive`：這是 Drive 權限裡範圍最廣的一個，授權後指令碼技術上能讀寫你整個 Drive。程式碼只對「`_users` 工作表記錄的會員試算表 id」呼叫 Drive，沒有搜尋或列出檔案，但你得信任這份程式碼。較窄的 `drive.file`（只含應用程式自己建立的檔案）理論上也涵蓋這些試算表，但 `DriveApp` 的官方文件只列出 `drive` 與 `drive.readonly`，我們無法在不實際部署的情況下確認 `drive.file` 可行，所以保守地用 `drive`。如果你願意試，可以在部署前把 `appsscript.json` 的 `drive` 換成 `drive.file`，並用最後一節的「刪除會員」步驟驗證；若刪除失敗，稽核紀錄會寫明「data spreadsheet could not be trashed」，帳號仍會被移除，你需手動刪除該試算表。

## 資料怎麼存

**控制試算表**（綁定的那份，或指令碼屬性 `SHEET_ID` 指定的）：

| 工作表 | 內容 |
|---|---|
| `_users` | 會員帳號、角色、狀態、是否允許管理員檢視、密碼雜湊、綁定的 Google 身分，以及該會員資料試算表的 id（只有 id）。 |
| `_sessions` | 登入狀態：session token 的 SHA-256、所屬會員、到期時間。過期的列會在下次寫入時清除。 |
| `_config` | 註冊模式（`approval` 或 `open`）、Google 用戶端 ID。 |
| `_audit` | 稽核紀錄，只留最近 1000 筆。 |

**每位會員一份自己的試算表**：會員第一次儲存資料時，才用 `SpreadsheetApp.create` 建立（名稱是 `Exfolio data <會員 id>`，不含帳號名稱），存在你的 Drive 根目錄。裡面有各資料表（`brokers`、`accounts`、`indices`、`instruments`、`transactions`、`loans`、`prices`、`fxRates`、`targets`、`strategies`、`snapshots`、`settings`、`tradeGroups`、`rotationCycles`、`priceHistory`、`rollovers`、`cashflowItems`、`scenarios`）各一個工作表，加上記錄版本號的 `_meta`。這樣會員之間在檔案層級就是分開的，也不會讓一份試算表長出幾百個分頁。刪除會員時，他的試算表會被移到垃圾桶（保留 30 天後 Google 才永久刪除）。

每一列的完整內容以 JSON 存在最後一欄 `_json`，這是唯一的資料來源。其他欄位只是方便閱讀的鏡像，每次儲存都會重寫：

- 直接改一般欄位**不會生效**，下次儲存就被覆蓋。
- 要手動修資料，請改 `_json` 欄，或用網站的備份與還原。
- 密碼雜湊、salt、session token 雜湊、Google 身分識別碼**不會**出現在鏡像欄位，只在 `_json` 裡。但**任何能開啟控制試算表的人都能讀到 `_json`**，見下一節。

所有儲存格都是純文字格式，避免 Sheets 把 `0050` 變成 `50`、把日期字串變成日期。

### 升級前就有的資料

如果控制試算表本來就有舊版（單人、共用 token 時期）的資料工作表，第一位註冊的會員會得到一份複製（寫進他自己的試算表，連同版本號），只做一次，之後記在 `_config`。原本的工作表不會被刪除，確認新資料無誤後請自行刪掉，免得它們繼續留在控制試算表裡。

## 密碼與登入狀態

- 瀏覽器先把密碼用 PBKDF2（200,000 次）延展成 `passwordKey` 再送出，密碼本身不會離開瀏覽器。
- 後端存 `salt` 與對 `passwordKey` 再做 1000 輪 PBKDF2-HMAC-SHA-256 的結果（`PASSWORD_ROUNDS`）。因為重的延展已在瀏覽器完成，這裡刻意取少：Apps Script 每輪都是一次服務呼叫，很慢。每位會員的輪數與 salt 存在自己的列，之後調高常數不會讓舊帳號失效。我們沒辦法在本機量出真實執行時間，請見最後一節。
- 帳號不存在時也會做同樣的雜湊，避免從回應時間得知哪些帳號存在。比對採固定時間。
- session token 是 256 位元，由四個 `Utilities.getUuid()`、時間與 `Math.random()` 經 SHA-256 混合而成。真正的亂度來自 `getUuid()`（隨機 UUID，Google 未公開其產生器，我們假設它是密碼學等級的隨機源）；時間與 `Math.random()` 只是攪拌，不算亂度。後端只存 token 的 SHA-256，有效期限 30 天。
- 登入失敗次數限制：同一帳號名稱 15 分鐘內失敗 8 次就回 `rate_limited`。計數存在 `CacheService`，那是盡力而為的快取，可能被提早清掉，限制因此可能比預期早解除。知道帳號名稱的人也可以讓該帳號暫時無法以密碼登入。
- 所有會寫入的動作都在 `LockService` 的指令碼鎖內執行（最長等 20 秒）。

## Google 登入

1. 到 [Google Cloud Console](https://console.cloud.google.com/)，建立（或選一個）專案，進入「API 和服務 → 憑證」。
2. 設定 OAuth 同意畫面（測試階段選「外部」並把測試使用者加進去即可）。
3. 「建立憑證 → OAuth 用戶端 ID」，應用程式類型選「網頁應用程式」。
4. 「已授權的 JavaScript 來源」填網站的 origin，也就是不含路徑的網址（例如 GitHub Pages 的 `https://<帳號>.github.io`；本機開發加上 `http://localhost:5173`）。不需要填重新導向 URI。
5. 複製產生的用戶端 ID，用管理員登入網站，在管理頁貼上「Google 用戶端 ID」並儲存。
6. 登入頁就會出現 Google 登入按鈕。已登入的會員可以在帳號頁綁定自己的 Google 帳號。

後端向 `oauth2.googleapis.com/tokeninfo` 驗證 ID token，並要求 `aud` 等於設定的用戶端 ID、發行者是 `accounts.google.com`、未過期、`email_verified` 為真、有 `sub`；任何一項不符都回 `invalid_credentials`。Google 登入絕不會因為帳號名稱相同就附加到既有帳號；新的 Google 身分會建立新會員，狀態依註冊模式決定。

## 網址的保管

- 網址不寫進任何提交的檔案（`npm run check:privacy` 會擋下 GAS 網址），只放在 GitHub repository variable 與瀏覽器設定裡。
- 但公開網站一定要呼叫它，所以**網址會出現在建置出的網站程式碼裡，任何人都看得到**。它不是秘密：保護靠 Google 登入、管理員審核與 session，而不是網址保密。

## 安全性：你應該知道的限制

存取權設成「所有人」是必要的，否則從 GitHub Pages 發出的請求過不了 Google 登入。因此這個網址本身是公開可呼叫的，保護完全靠 session：

- 沒有有效 session，後端不回任何會員資料，也不替人抓報價。
- **架設的人看得到一切。** 你（部署者）可以直接開啟控制試算表與每位會員的試算表。`_users` 的 `_json` 欄裡有密碼雜湊與 salt，`_sessions` 裡有 session token 的雜湊。雜湊不是明碼，但持有它們的人可以離線猜密碼；密碼已在瀏覽器端做過 200,000 次延展，這能拉高成本，不能消除風險。請把這兩份試算表的分享設定保持私人。
- 會員能不能被「管理員」檢視，由會員自己決定（預設開啟，隨時可關）。這只約束網站功能；架設者直接開試算表不受影響，請如實告訴使用者。
- 管理員檢視他人資料一律唯讀，且每次都寫入 `_audit`。
- Google 登入要先呼叫 `loginChallenge` 取得一次性的 challenge（存在 `CacheService`，10 分鐘有效、用一次就失效），Google 會把它寫進 ID token 的 `nonce`。沒有有效 challenge 的請求在呼叫 tokeninfo 之前就被拒絕，截到的舊 token 也無法重放。
- 每位會員最多同時 5 個 session，超過時最舊的失效。
- 登入端點沒有登入也能呼叫。新的 Google 身分會建立一列「待核准」會員；`MAX_PENDING`、`MAX_MEMBERS` 限制了總量，滿了就回 `registration_full`。「開放註冊」模式下新會員直接啟用，公開網站請保持「管理員審核」。
- Apps Script 有每日請求數、執行時間與試算表讀寫的配額，每次請求都要讀取控制試算表。這個後端適合你與少數親友，不適合大量或公開的使用者；那時請換成有正式身分驗證與資料庫的後端。
- 指令碼以你的身分執行，不持有任何券商或交易所的金鑰，也不能下單。

## 報價

GAS 端用 `UrlFetchApp` 抓 Yahoo Finance、Binance 與期交所的公開端點，快取 20 秒，且需要有效 session。三者都不是授權行情：可能延遲、限流或變更。Apps Script 每日有對外請求配額；頁面開著時每 30 秒更新一次，長時間開著可能用完配額，屆時報價會停更但資料讀寫不受影響。

## 已知的弱點（部署前請先讀）

- **申請名額可能被佔滿。** 任何有 Google 帳號的人都能送出申請；有人大量申請時，待審核名額（`MAX_PENDING`）會被佔滿，正常的新會員暫時無法申請，直到管理員刪除或核准。已核准的會員與 `ADMIN_EMAILS` 不受影響。
- **配額。** Apps Script 沒有入口限流：任何人都能反覆呼叫網址（例如大量索取 challenge 或公開的 `config`，後者已快取 60 秒），每次都會耗用這個部署的執行配額；已登入的動作每次都要讀取控制試算表。配額用完時，所有會員（包括管理員）暫時無法登入或儲存，報價不受影響（公開版的報價不經 GAS）。**這個架構適合受邀的小群體**；要對不特定的陌生人開放，需要有入口限流與正式資料庫的後端。
- **開啟 `PASSWORD_LOGIN` 時**，第一個用密碼註冊的帳號會成為管理員（舊行為），網址外流時可能被搶先；公開網站請保持關閉。

## 部署後驗證

程式只在模擬環境測過，下列項目請在真實部署逐一確認：

1. 公開網站右上角出現「會員登入」，登入頁顯示 Google 按鈕。
2. 用 `ADMIN_EMAILS` 的帳號登入，確認它是管理員，控制試算表的 `_users` 出現一列、`_audit` 有 `register`（detail 為 `admin address: admin`）。
3. 用另一個 Google 帳號登入，應顯示「待核准」；用密碼註冊應被拒絕（`password_disabled`）。
4. 儲存一筆資料，確認 Drive 多了一份 `Exfolio data …` 試算表，`transactions` 等工作表有該列，控制試算表本身沒有投資資料；重新整理網頁資料仍在。
5. 開啟 `_users`、`_sessions`，確認可讀欄位沒有密碼雜湊、salt、token 雜湊。
6. 用第二個瀏覽器註冊第二個帳號：登入應顯示「待核准」；管理員核准後可登入，且看不到第一個帳號的資料。
7. 第二個帳號關閉「允許管理員檢視」後，管理員檢視它應被拒絕；開啟後可檢視，且 `_audit` 有 `view-data`。
8. （只在開啟 `PASSWORD_LOGIN` 時）連續輸入 8 次錯誤密碼，第 9 次應回「嘗試次數過多」；修改密碼後其他裝置的登入應失效。
9. 在試算模式輸入一筆倉位後登入：帳號是空的會直接存入；帳號已有資料時會詢問。
10. 刪除第二個帳號，確認它的試算表進了 Drive 垃圾桶（驗證 `drive` scope 可用，也驗證若改用 `drive.file` 是否可行）。
11. 設定 Google 用戶端 ID 後測試 Google 登入與綁定；用另一個應用程式的 ID token 應被拒絕。
12. 按「更新報價」，確認價格與時間有更新；登出後同一個請求應被拒絕。
13. 同時從兩個分頁儲存，確認其中一個得到衝突提示，資料不會互相覆蓋。
