# 停車資訊查詢系統 - 完整總結

## 📦 專案結構

```
papaking/
├── line_webhook.py          # LINE Bot Webhook (Sanic 框架)
├── main.py                  # TDX API 主程式 (含 Formatter)
├── parser.py                # 停車資料解析器
├── json_helpers.py          # JSON 處理工具
├── examply.py               # API 使用範例
├── requirements.txt         # Python 套件依賴
├── .env.example             # 環境變數範本
├── LINE_WEBHOOK_README.md   # LINE Webhook 說明文件
└── api_oas.json            # TDX API 規格文件
```

## 🚀 核心功能

### 1. LINE Webhook (Sanic 版本)
**檔案**: `line_webhook.py`

**特色**:
- ✅ 使用高效能 Sanic 非同步框架
- ✅ 接收 LINE 地理位置訊息
- ✅ 自動查詢附近 500m 內的停車場 (Top 10)
- ✅ 計算實際距離 (Haversine 公式)
- ✅ 回傳精簡核心資訊
- ✅ 使用 json_helpers 處理 JSON

**回傳資訊包含**:
- 停車場名稱與類型 (平面/立體/地下等)
- 距離 (公里)
- 地址
- 收費方式 (計時/計次/月租/免費)
- 特殊服務 (📊動態車位、⚡充電、📅預約)
- 公有/私有
- 電話
- Google Maps 連結

**API 端點**:
- `POST /callback` - LINE Webhook
- `GET /health` - 健康檢查
- `GET /` - 服務資訊

### 2. 停車資料解析器
**檔案**: `parser.py`

**功能**:
- 解析 TDX API 三種資料類型
  - 路外停車場 (parse_carpark)
  - 路邊停車格 (parse_parking_spot)
  - 停車路段 (parse_parking_segment)
- 完整的編碼對照表 (30 種停車位類型)
- 批次解析功能
- 資料摘要生成

### 3. 主程式與格式化工具
**檔案**: `main.py`

**功能**:
- TDX API 認證與查詢
- ParkingAPI 類別 (4 個 API 方法)
- ParkingDataFormatter 類別
- JSON 格式輸出
- 人類可讀格式輸出
- 互動式選擇輸出格式
- 自動儲存 JSON 檔案

### 4. JSON 處理工具
**檔案**: `json_helpers.py`

**功能**:
- 使用 msgspec 高效能 JSON 處理
- 自訂編碼器支援 datetime 等類型
- dumps() 函數 (相容 json.dumps API)

## 📊 支援的編碼類型

### 停車場類型 (8 種)
平面、立體、地下、立體停車塔、立體機械式等

### 停車位類型 (30 種)
自小客車、機車、電動車、身心障礙、月租、季租、年租等

### 停車服務類型 (24 種)
軌道場站、機場、商圈、餐廳、觀光景點、學校等

### 收費方式 (5 種)
計時、計次、月租、免費、其他

## 🔧 快速開始

### 1. 安裝依賴
```bash
pip install -r requirements.txt
```

### 2. 設定環境變數
```bash
cp .env.example .env
# 編輯 .env 填入您的金鑰
```

### 3. 啟動 LINE Webhook
```bash
python3 line_webhook.py
```

### 4. 執行主程式範例
```bash
python3 main.py
```

### 5. 測試解析器
```bash
python3 parser.py
```

## 📋 環境變數

```env
# LINE Bot
LINE_CHANNEL_ACCESS_TOKEN=你的_Token
LINE_CHANNEL_SECRET=你的_Secret

# TDX API
CLIENT_ID=你的_Client_ID
CLIENT_SECRET=你的_Client_Secret
```

## 🎯 使用範例

### LINE Bot 使用
1. 將 Bot 加入好友
2. 傳送位置訊息
3. 收到附近停車場清單

### Python API 使用
```python
from parser import parse_tdx_parking_data

# 解析停車場資料
result = parse_tdx_parking_data(raw_data, 'carpark')
print(result['summary'])
for item in result['data']:
    print(item['basic_info']['name'])
```

## 📈 效能特色

- **Sanic 框架**: 高效能非同步處理
- **msgspec**: 快速 JSON 序列化
- **aiohttp**: 非同步 HTTP 請求
- **批次查詢**: 一次取得多筆資料

## 🔐 安全性

- ✅ LINE Webhook 簽名驗證
- ✅ 環境變數存放敏感資訊
- ✅ 禁用 debug 模式 (生產環境)
- ✅ Ruff lint 檢查通過

## 📝 完整文件

- **LINE Webhook**: 查看 `LINE_WEBHOOK_README.md`
- **API 規格**: 查看 `api_oas.json`
- **使用範例**: 查看 `examply.py`

## 🎉 總結

本專案提供完整的停車資訊查詢解決方案，包含：
- ✅ LINE Bot 整合
- ✅ TDX API 串接
- ✅ 資料解析與格式化
- ✅ 高效能非同步處理
- ✅ 完整的類型對照
- ✅ 人性化的輸出格式

適用於開發停車場導引、智慧停車系統、LINE Bot 應用等場景。
