# LINE 停車場查詢 Webhook (Pure aiohttp)

使用 Sanic + aiohttp 實現的 LINE Bot，**不依賴 LINE SDK**，直接處理 Webhook。

## 🎯 特色

- ✅ **Pure aiohttp**: 不使用 LINE SDK，直接用 aiohttp 發送訊息
- ✅ **Sanic 框架**: 高效能非同步 Web 框架
- ✅ **簽名驗證**: 使用 HMAC-SHA256 驗證 LINE Webhook 簽名
- ✅ **自動查詢**: 收到位置後自動查詢附近 500m 停車場 (Top 10)
- ✅ **精簡回應**: 只回傳核心停車場資訊

## 📦 安裝依賴

```bash
pip install sanic aiohttp python-dotenv
```

或使用 requirements.txt:

```bash
pip install -r requirements.txt
```

## 🔧 環境設定

複製環境變數範本：

```bash
cp .env.example .env
```

編輯 `.env` 檔案：

```env
LINE_CHANNEL_ACCESS_TOKEN=你的_Channel_Access_Token
LINE_CHANNEL_SECRET=你的_Channel_Secret
CLIENT_ID=你的_TDX_Client_ID
CLIENT_SECRET=你的_TDX_Client_Secret
```

## 🚀 啟動服務

```bash
python3 line_webhook.py
```

服務將在 `http://0.0.0.0:5000` 啟動。

## 📡 API 端點

### POST /callback
LINE Webhook 回呼端點

**處理流程**:
1. 驗證 X-Line-Signature
2. 解析 JSON webhook 資料
3. 檢測 location 訊息類型
4. 查詢 TDX 停車場 API
5. 使用 aiohttp POST 發送回覆到 LINE

### GET /health
健康檢查端點

**回應範例**:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-04T13:37:00.000Z"
}
```

### GET /
服務資訊端點

**回應範例**:
```json
{
  "service": "LINE Parking Webhook (Sanic + aiohttp)",
  "version": "3.0.0",
  "framework": "Sanic (No LINE SDK)",
  "description": "接收 LINE 地理位置訊息，查詢附近停車場資訊",
  "endpoints": {
    "webhook": "/callback",
    "health": "/health"
  }
}
```

## 🔐 簽名驗證

使用 HMAC-SHA256 驗證 LINE Webhook 簽名：

```python
def verify_signature(body: bytes, signature: str) -> bool:
    """驗證 LINE Webhook 簽名"""
    computed_signature = hmac.new(
        CHANNEL_SECRET.encode("utf-8"), 
        body, 
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, computed_signature)
```

## 📤 發送訊息

直接使用 aiohttp POST 到 LINE API：

```python
async def send_reply_message(reply_token: str, text_message: str) -> bool:
    """使用 aiohttp 發送 LINE 回覆訊息"""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {CHANNEL_ACCESS_TOKEN}",
    }
    
    payload = {
        "replyToken": reply_token,
        "messages": [{"type": "text", "text": text_message}],
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.post(LINE_REPLY_URL, headers=headers, json=payload) as response:
            return response.status == 200
```

## 📱 使用流程

1. 將 LINE Bot 加入好友
2. 在聊天室點擊「位置」按鈕
3. 傳送目前位置或選擇地圖位置
4. Bot 自動回覆附近停車場清單

## 📋 回覆訊息格式

```
🅿️ 找到 10 個停車場
📍 搜尋位置: (25.047675, 121.517055)
🔍 搜尋範圍: 500 公尺
==============================

【1】台北車站地下停車場 (約0.2km)
🏗️ 地下 | 公有
💰 計時
📊動態車位 ⚡充電
📮 台北市中正區市民大道一段100號
📞 02-2361-3062
📍 https://www.google.com/maps?q=25.0478,121.5170

【2】新光三越站前店停車場 (約0.3km)
🏗️ 立體 | 私有
💰 計時
⚡充電 ��預約
📮 台北市中正區忠孝西路一段66號
📞 02-2388-5558
📍 https://www.google.com/maps?q=25.0465,121.5165

...

==============================
🕐 查詢時間: 2025-11-04 21:37:00
```

## 🔍 LINE Webhook 事件格式

接收到的 Webhook JSON 範例：

```json
{
  "destination": "xxxxxxxxxx",
  "events": [
    {
      "type": "message",
      "message": {
        "type": "location",
        "id": "123456789",
        "latitude": 25.047675,
        "longitude": 121.517055,
        "address": "台北市中正區"
      },
      "timestamp": 1699123456789,
      "source": {
        "type": "user",
        "userId": "U1234567890abcdef"
      },
      "replyToken": "xxxxxxxxxxxxxxxxxxxxx"
    }
  ]
}
```

## 🧪 本地測試

使用 ngrok 讓 LINE 可以連到本機：

```bash
# 1. 啟動服務
python3 line_webhook.py

# 2. 在另一個終端啟動 ngrok
ngrok http 5000

# 3. 複製 ngrok 提供的 https URL
# 4. 到 LINE Developers Console 設定 Webhook URL:
#    https://xxxx.ngrok.io/callback
```

## 🚢 部署建議

### Docker 部署

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY line_webhook.py .

ENV LINE_CHANNEL_ACCESS_TOKEN=""
ENV LINE_CHANNEL_SECRET=""
ENV CLIENT_ID=""
ENV CLIENT_SECRET=""

EXPOSE 5000

CMD ["python", "line_webhook.py"]
```

### 使用 Docker Compose

```yaml
version: '3.8'

services:
  line-webhook:
    build: .
    ports:
      - "5000:5000"
    environment:
      - LINE_CHANNEL_ACCESS_TOKEN=${LINE_CHANNEL_ACCESS_TOKEN}
      - LINE_CHANNEL_SECRET=${LINE_CHANNEL_SECRET}
      - CLIENT_ID=${CLIENT_ID}
      - CLIENT_SECRET=${CLIENT_SECRET}
    restart: unless-stopped
```

## 📊 效能特色

| 功能 | 傳統方式 | 本專案 |
|------|---------|--------|
| LINE SDK | line-bot-sdk | ❌ 不使用 |
| HTTP 客戶端 | requests | ✅ aiohttp (非同步) |
| Web 框架 | Flask | ✅ Sanic (非同步) |
| 訊息發送 | SDK 封裝 | ✅ 直接 POST |
| 依賴套件 | 3-4 個 | ✅ 2 個 (sanic, aiohttp) |

## 🛠️ 故障排除

### Webhook 驗證失敗
檢查 `LINE_CHANNEL_SECRET` 是否正確

### 無法發送訊息
檢查 `LINE_CHANNEL_ACCESS_TOKEN` 是否正確且有效

### 找不到停車場
- 確認位置在台灣範圍內
- 檢查 TDX API 金鑰是否有效

### aiohttp 連線錯誤
檢查網路連線和 API 端點是否可達

## 📚 相關資源

- [LINE Messaging API Reference](https://developers.line.biz/en/reference/messaging-api/)
- [TDX 運輸資料流通服務](https://tdx.transportdata.tw/)
- [Sanic 官方文件](https://sanic.dev/)
- [aiohttp 官方文件](https://docs.aiohttp.org/)

## 🎉 優勢

✅ **零 LINE SDK 依賴**: 完全掌控 API 互動
✅ **高效能**: 全非同步處理
✅ **輕量級**: 最少依賴套件
✅ **易於理解**: 清晰的 HTTP POST/GET 操作
✅ **彈性高**: 可自由擴展功能

## 授權

MIT License

## 作者

PapaKing Team
