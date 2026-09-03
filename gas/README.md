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

   `TDX_KEYS` 可放多把。基礎會員每把 5 次/分，程式會在撞到 429 時自動換下一把。
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

## 🔧 測試

在 Apps Script 編輯器執行：
```javascript
testFull()  // 完整測試
testConfig()  // 驗證設定
```

## 📚 詳細文件

完整部署指南與技術說明：
https://www.notion.so/2a37a24cf64081dcbc11c8948ad10337
