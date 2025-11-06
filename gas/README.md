# Google Apps Script 版本

無伺服器實作的 LINE Bot，完全免費託管。

## 🚀 部署步驟

1. 前往 [Google Apps Script](https://script.google.com)
2. 建立新專案
3. 將 `line_webhook_gas.js` 的內容貼上
4. 設定環境變數：
   ```javascript
   var LINE_CHANNEL_ACCESS_TOKEN = 'your_token'
   var LINE_CHANNEL_SECRET = 'your_secret'
   var TDX_CLIENT_ID = 'your_tdx_id'
   var TDX_CLIENT_SECRET = 'your_tdx_secret'
   ```
5. 部署為 Web App（執行身分：我，存取權：任何人）
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
