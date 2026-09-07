# PapaKing 架設教學

三個帳號、一份程式碼、兩個金鑰。全程免費，不用信用卡，不用伺服器。
能用指令做的步驟都附指令；只想點網頁的人照「網頁操作」那欄做也行。

| 步驟 | 要拿到的東西 | 花多久 |
|------|------------|--------|
| [1. TDX 申請 API key](#1-tdx-申請-api-key) | `Client Id` + `Client Secret` | 5 分鐘，審核即時 |
| [2. LINE 官方帳號申請](#2-line-官方帳號申請) | `Channel access token` | 10 分鐘 |
| [3. GAS 程式碼配置與金鑰管理](#3-gas-程式碼配置與金鑰管理) | Web App URL，填回 LINE | 10 分鐘 |

- 第 2 步：[建立官方帳號](#2-1-建立官方帳號) · [啟用 Messaging API](#2-2-啟用-messaging-api) · [發行 Channel access token](#2-3-發行-channel-access-token) · [用 API 設定 Webhook](#2-4-用-api-設定-webhook等第-3-步拿到-url-再做)
- 第 3 步：[用 clasp 部署](#3-a-用-clasp-部署) · [用網頁貼上](#3-b-用網頁貼上) · [填金鑰](#3-c-填金鑰兩條路都要做) · [授權並驗證](#3-d-授權並驗證) · [接回 LINE 並試用](#3-e-接回-line-並試用)
- [贊助](#贊助) · [問答 QA](#問答-qa)


## 1. TDX 申請 API key

TDX（運輸資料流通服務平臺）提供全台路邊停車格與停車場資料，PapaKing 的主要資料來源。

1. 到 <https://tdx.transportdata.tw/register> 註冊會員，用 Email 或 Google 帳號都可以。
2. 登入後右上角「會員中心」→ 左側「資料服務」→「API 金鑰」。
3. 按「新增 API 金鑰」，名稱隨意填（例如 `papaking`），送出。
4. 列表會出現 `Client Id` 與 `Client Secret`，兩個都複製起來，第 3 步要用。

> **一把不夠可以多申請幾把。** 基礎會員每把金鑰每分鐘 5 次呼叫。一次位置查詢會打 2 次 TDX，
> 也就是一把金鑰一分鐘只能撐 2 個人查。PapaKing 支援多把金鑰輪替：撞到 429 會自動換下一把，
> 全部用滿才回覆「稍後再試」。個人用一把夠，要分享給朋友用就多申請兩把。

TDX 沒有開放「建立金鑰」的 API，這一步只能在網頁做。


## 2. LINE 官方帳號申請

LINE Bot 的本體是「LINE 官方帳號」加上「Messaging API channel」。
2024 年 9 月起，channel 只能從官方帳號管理後台開，不能直接在 Developers Console 建。

### 2-1. 建立官方帳號

1. 到 <https://manager.line.biz/> ，用 LINE 帳號登入（第一次會要你註冊 LINE Business ID）。
2. 「建立 LINE 官方帳號」，填帳號名稱（例如 `PapaKing 停車查詢`）、業種隨意選、Email 填你的。
3. 建好後進入該帳號的管理畫面。

### 2-2. 啟用 Messaging API

1. 管理畫面右上「設定」→ 左側「Messaging API」→「啟用 Messaging API」。
2. 會要你選或建立一個 **Provider**（開發者名稱，隨意填），同意條款後啟用完成。
3. 同一頁往下捲，「回應設定」把這兩項調成：

   | 項目 | 設定 | 原因 |
   |------|------|------|
   | 聊天 | 關閉 | 開著會跟 Bot 搶訊息 |
   | 自動回應訊息 | 關閉 | 不關會多一則罐頭回覆 |
   | Webhook | 開啟 | Bot 要靠這個收到位置訊息 |

### 2-3. 發行 Channel access token

1. 到 <https://developers.line.biz/console/> ，選剛剛的 Provider → 你的 channel。
2. 「Messaging API」分頁最下方「Channel access token (long-lived)」→「Issue」。
3. 複製那一長串 token，第 3 步要用。**這是機密，別貼進程式碼或截圖。**

> Channel secret 在 PapaKing 用不到：Apps Script 的 `doPost(e)` 讀不到 HTTP 標頭，
> 拿不到 `X-Line-Signature`，簽章驗證在 GAS 上做不了。

### 2-4. 用 API 設定 Webhook（等第 3 步拿到 URL 再做）

有了 token 之後，Webhook URL 可以用 API 設，不用回網頁點：

```bash
export LINE_TOKEN='你的 channel access token'
export WEBAPP_URL='https://script.google.com/macros/s/XXXX/exec'   # 第 3 步會拿到

# 設定 Webhook URL
curl -X PUT https://api.line.me/v2/bot/channel/webhook/endpoint \
  -H "Authorization: Bearer $LINE_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"endpoint\":\"$WEBAPP_URL\"}"

# 確認設定成功（active 應為 true）
curl https://api.line.me/v2/bot/channel/webhook/endpoint -H "Authorization: Bearer $LINE_TOKEN"

# 讓 LINE 打一次測試請求
curl -X POST https://api.line.me/v2/bot/channel/webhook/test \
  -H "Authorization: Bearer $LINE_TOKEN" -H 'Content-Type: application/json' -d '{}'
```

網頁操作的等價步驟：Developers Console → Messaging API 分頁 → Webhook settings → Edit → 貼 URL → Update → Verify → 打開 Use webhook。


## 3. GAS 程式碼配置與金鑰管理

程式跑在 Google Apps Script（GAS）上，Google 免費託管，不用伺服器。
兩條路：**A. clasp 指令**（適合會用終端機的人，之後更新程式一行指令）；**B. 網頁貼上**（零安裝）。

### 3-A. 用 clasp 部署

clasp 是 Google 官方的 Apps Script 命令列工具，需要 Node.js 20 以上（以 clasp 3.3 驗證）。

```bash
npm install -g @google/clasp
clasp login                       # 開瀏覽器授權一次
```

第一次要到 <https://script.google.com/home/usersettings> 把「Google Apps Script API」打開，不然 clasp 會被拒。

```bash
git clone https://github.com/coseto6125/papaking.git
cd papaking

clasp create-script --title "PapaKing" --rootDir gas    # 建立專案，產生 .clasp.json
git checkout gas/appsscript.json                        # create-script 會拉下空專案的預設 manifest 蓋掉這個檔，先還原
clasp push                                              # 上傳 gas/ 裡的程式與 appsscript.json
clasp create-deployment --description "v1"              # 部署為 Web App
clasp list-deployments                                  # 抄下 deploymentId
```

Web App URL 的格式是 `https://script.google.com/macros/s/<deploymentId>/exec`。
`gas/appsscript.json` 已經寫好「執行身分：我、存取權：任何人（含匿名）」，LINE 的伺服器才打得進來。

> 舊版 clasp 的指令名稱是 `clasp create`、`clasp deploy`、`clasp deployments`，功能相同。

之後改了程式：

```bash
clasp push
clasp create-deployment --deploymentId <上面抄的 id> --description "v2"   # 沿用同一個 URL
```

### 3-B. 用網頁貼上

1. 到 <https://script.google.com> →「新專案」，左上角把專案名稱改成 `PapaKing`。
2. 把 [`gas/line_webhook_gas.js`](../gas/line_webhook_gas.js) 整份內容貼進 `程式碼.gs`，Ctrl+S。
3. 右上「部署」→「新增部署作業」→ 齒輪選「網頁應用程式」：
   - 執行身分：**我**
   - 誰可以存取：**任何人**
4. 按「部署」，複製「網頁應用程式 URL」。

之後改了程式：「部署」→「管理部署作業」→ 鉛筆 → 版本選「新版本」→ 部署。**不建新版本，線上的還是舊程式。**

### 3-C. 填金鑰（兩條路都要做）

金鑰放在 GAS 的「指令碼屬性」，不進程式碼，也不進 git。

1. Apps Script 編輯器左側齒輪「專案設定」→ 最下方「指令碼屬性」→「新增指令碼屬性」。
2. 新增兩筆：

   | 屬性 | 值 |
   |------|-----|
   | `LINE_CHANNEL_ACCESS_TOKEN` | 第 2-3 步的 token |
   | `TDX_KEYS` | `[{"id":"第1步的ClientId","secret":"第1步的ClientSecret"}]` |

   多把 TDX 金鑰就多放幾個物件：`[{"id":"a","secret":"b"},{"id":"c","secret":"d"}]`。

3. 儲存。

指令碼屬性沒有公開 API，clasp 也設不了，這一步只能在網頁做，但只做一次。

### 3-D. 授權並驗證

第一次執行要授權程式使用 UrlFetch 與 Maps 服務，clasp 部署不會觸發這個畫面，所以：

1. 編輯器上方函式下拉選 `testConfig` → 「執行」。
2. 跳出授權視窗 → 選你的帳號 → 「進階」→「前往 PapaKing（不安全）」→ 允許。
   （「不安全」是因為這是你自己寫的、沒送 Google 審核的程式。）
3. 下方執行記錄顯示 `✓ 設定完整，TDX 金鑰 N 把` 就對了。
4. 想看完整流程，改跑 `testFull`，會用三個測試座標各查一次。

### 3-E. 接回 LINE 並試用

拿 Web App URL 回到第 2-4 步設定 Webhook。然後用手機 LINE 加 Bot 好友（Developers Console 的 Messaging API 分頁有 QR code），
點「+」→「位置資訊」傳一個位置，幾秒內會收到附近停車格與停車場的卡片。


## 贊助

這個 Bot 跑在免費額度上，維護靠愛發電。覺得好用的話，歡迎請作者喝杯咖啡；贊助時在「留言」寫下你想要的功能，有機會優先做。

[![贊助 PapaKing](../image/sponsor_banner.gif)](https://p.ecpay.com.tw/AA249AA)


## 問答 QA

#### 傳位置沒回應？

依序檢查：

1. Apps Script 左側「執行」頁有沒有 `doPost` 的紀錄。沒有就是 Webhook URL 沒設好，或 LINE 後台的 Webhook 沒打開。
2. 有紀錄但失敗：點進去看錯誤。`TDX_KEYS 未設定` 或 `LINE_CHANNEL_ACCESS_TOKEN 未設定` 就是 [3-C](#3-c-填金鑰兩條路都要做) 沒填對。
3. 都正常但沒回覆：可能改了程式沒建新版本部署，見 3-A / 3-B 最後一段。

#### LINE 後台按 Verify 顯示錯誤，可是傳位置有回？

沒事。GAS 的 Web App 會先回 302 轉址，Verify 有時判定失敗，實際的事件還是收得到。以傳訊息測試為準。

#### 回覆「查詢人數太多，請一分鐘後再試」？

所有 TDX 金鑰這一分鐘的 5 次額度都用完了。等一分鐘，或多申請一把金鑰加進 `TDX_KEYS`（見 [第 1 步](#1-tdx-申請-api-key)）。

#### 開車時間不見了，只剩距離？

Google Maps 的免費配額（一般帳號每日約 1,000 次路線查詢）用完了，程式會靜默退回直線距離，隔天恢復。一次查詢最多用 5 次，大約 200 次查詢會用完。

#### Channel secret 要填哪？

不用填。GAS 讀不到 LINE 的簽章標頭，程式沒做簽章驗證。這也代表任何知道 Web App URL 的人都能觸發查詢，URL 別公開。

#### 可以放在同一個 Google 帳號的多個專案嗎？金鑰會不會互相影響？

指令碼屬性是每個專案獨立的，互不影響。TDX 的每分鐘額度是算金鑰的，兩個專案用同一把就要分著用。

#### 程式更新了要怎麼跟上？

| 路線 | 做法 |
|------|------|
| clasp | `git pull` 後 `clasp push`，再用原本的 deploymentId 建新版本 |
| 網頁 | 重新貼一次程式碼，再建新版本部署 |

指令碼屬性不用重填。

#### 新北、基隆的停車場資料跟別的縣市不一樣？

TDX 在這兩個縣市只有部分業者上傳的場站，程式另外接了新北開放資料與基隆市政府的資料補上。其他縣市純用 TDX。詳見 [`gas/README.md`](../gas/README.md) 的資料來源表。

#### 這個專案可以商用嗎？

授權是 CC BY-NC 4.0，個人與非營利免費；商業用途請來信 enorenor@gmail.com。
