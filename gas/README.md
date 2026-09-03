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
- `rankByTravel()` / `driveTime()` - 直線最近的前 5 個路段、前 3 個停車場再問 Google 開車時間並依時間重排
- `navLink()` - 產生 Google Maps 開車導航連結（不吃配額）

## ⚠️ Google Maps 配額

`Maps` 服務不用 API key，但一般 Gmail 帳號每日上限約 1,000 次 directions、1,000 次 geocoding。一次位置查詢最多 8 次 directions（5 路段 + 3 停車場）加最多 1 次 geocoding，約 125 次查詢會用完當日 directions 配額；用完後開車時間靜默退回直線距離，只有執行記錄會有「開車時間查詢失敗」。

## 🔧 測試

在 Apps Script 編輯器執行：
```javascript
testFull()  // 完整測試
testConfig()  // 驗證設定
```

## 📚 詳細文件

完整部署指南與技術說明：
https://www.notion.so/2a37a24cf64081dcbc11c8948ad10337
