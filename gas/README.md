# Google Apps Script 版本

無伺服器實作的 LINE Bot，完全免費託管。

## 🚀 部署步驟

1. 前往 [Google Apps Script](https://script.google.com)
2. 建立新專案
3. 將 `line_webhook_gas.js` 的內容貼上
4. 在「專案設定 > 指令碼屬性」新增以下屬性（**不要寫進程式碼**，會隨原始碼外流）：

   | 屬性名稱 | 值 |
   |---|---|
   | `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers Console 的 Channel access token |
   | `TDX_KEYS` | TDX 金鑰陣列，JSON 格式：`[{"id":"...","secret":"..."}]` |

   `TDX_KEYS` 可放多把。基礎會員每把 5 次/分，程式依本分鐘用量挑用得最少的一把；撞到 429（頻率上限）或 401/403（金鑰失效）會自動換下一把，全部用滿時回覆使用者稍後再試。
5. 部署為 Web App（執行身分：我，存取權：任何人）

   > ⚠️ 這個端點不做請求驗證。Apps Script 的 `doPost(e)` 讀不到 HTTP 標頭，
   > 拿不到 `X-Line-Signature`，所以 LINE 官方的簽章驗證在 GAS 上做不到。
   > 任何知道 Web App URL 的人都能觸發查詢並消耗你的 TDX 與 Maps 配額。
6. 複製 Web App URL
7. 在 LINE Developers Console 設定 Webhook URL

## 📝 主要功能

- `doPost()` - 接收 LINE Webhook 事件
- `handleLocation()` - 處理位置訊息
- `queryOnStreet()` - 查詢路邊停車格
- `queryParking()` - 查詢停車場
- `calculateDistance()` - 計算距離
- `rankByTravel()` / `driveTime()` - 直線最近的前 3 個路段、前 2 個停車場再問 Google 開車時間並依時間重排（同起點格到同終點快取 30 分鐘）
- `navLink()` - 產生 Google Maps 開車導航連結（不吃配額）
- `buildReply()` - 兩個 TDX NearBy 用 `UrlFetchApp.fetchAll` 併發，再組回覆
- `ntpcCarparksNear()` - 新北市路外停車場改走新北開放資料（含每 3 分鐘更新的剩餘車位），座標由 TWD97 換算

## 🗂️ 資料來源

| 資料              | 來源                                                     | 備註                                     |
|-------------------|----------------------------------------------------------|------------------------------------------|
| 路邊停車格、路段  | TDX `Parking/OnStreet`                                   | 全國                                     |
| 路外停車場        | TDX `Parking/OffStreet/CarPark/NearBy`                   | 新北市、基隆市只有台鐵等業者自行上傳的場站 |
| 新北路外停車場    | 新北開放資料 `b1464ef0-…`（靜態）、`e09b35a5-…`（剩餘）  | 只含領有登記證的場站，私營臨停場不在內   |
| 基隆路外停車場    | 基隆市政府 CSV（22 座公有，Big5）、交通局即時頁（HTML）  | CSV 無座標，地址 geocode 一次後存屬性；即時頁靠名稱比對 |
| 開車時間、縣市    | Apps Script 內建 `Maps` 服務                             | 見下方配額                               |
| 私營路外停車場    | Google 地圖搜尋 RPC（無金鑰、非公開介面，**預設關閉**）  | 只有名稱、地址、座標、營業時間；欄位位置可能無預警改變，失效時靜默退回不顯示 |

## ⚠️ Google Maps 配額

`Maps` 服務不用 API key，但一般 Gmail 帳號每日上限約 1,000 次 directions、1,000 次 geocoding。一次位置查詢最多 5 次 directions（3 路段 + 2 停車場）加最多 1 次 geocoding，約 200 次查詢會用完當日 directions 配額；用完後開車時間靜默退回直線距離，只有執行記錄會有「開車時間查詢失敗」。

## 🔎 Google 地圖搜尋（第三來源）

TDX 與市府資料都沒有私營場站（歐特儀、Times、嘟嘟房）。`GOOGLE_PLACES_ENABLED` 開啟後會用 Google 地圖網頁版的搜尋 RPC 補進來，
每筆末尾標「ℹ️ 來源 Google」，與官方資料以「50m 內，或 300m 內且名稱互含」去重，官方那筆優先。
這不是官方 API：沒有配額保證，回應格式一改就靜默失效（執行記錄會有「回空清單」）。
啟用前先在編輯器執行 `testGooglePlaces()`，確認 Apps Script 的出口打得到並印出場站名單。

## 🔧 測試

在 Apps Script 編輯器執行：
```javascript
testFull()  // 完整測試
testConfig()  // 驗證設定
```

## 📚 詳細文件

完整部署指南與技術說明：
https://www.notion.so/2a37a24cf64081dcbc11c8948ad10337
