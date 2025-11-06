# 🅿️ PapaKing - 台灣停車資訊查詢 LINE Bot

基於 **TDX 運輸資料流通服務** 的停車場資訊查詢系統，透過 LINE Bot 提供附近停車資訊。

## ✨ 特色功能

- 🚗 **路邊停車格查詢** - 依路段分組顯示，只顯示小客車格
- 🏢 **停車場查詢** - 顯示名稱、地址等資訊
- 📍 **距離計算** - 使用 Haversine 公式計算精確距離
- 🗺️ **Google Maps 整合** - 一鍵導航到停車位置
- ⚡ **雙版本實作** - Google Apps Script（無伺服器）+ Python Sanic（高效能）

## 🏗️ 專案結構

```
papaking/
├── gas/              # Google Apps Script 版本（主要實作）
│   └── line_webhook_gas.js
├── sanic/            # Python Sanic 版本（替代方案）
│   ├── line_webhook.py
│   ├── papaking.py
│   ├── parser.py
│   ├── json_helpers.py
│   └── requirements.txt
├── docs/             # API 規格與文件
└── README.md
```

## 🚀 快速開始

### 方案 A：Google Apps Script（推薦）

**優勢：** 免費託管、零維護、快速部署

1. 前往 [Google Apps Script](https://script.google.com)
2. 建立新專案，貼上 `gas/line_webhook_gas.js`
3. 設定環境變數（LINE Token、TDX API Key）
4. 部署為 Web App
5. 設定 LINE Webhook URL

詳細步驟請參考：[完整部署文件](https://www.notion.so/2a37a24cf64081dcbc11c8948ad10337)

### 方案 B：Python Sanic

**適合：** 需要高度客製化或大流量場景

```bash
cd sanic
pip install -r requirements.txt

# 設定 .env
cp ../.env.example .env
# 編輯 .env 填入你的 API Keys

# 啟動伺服器
python line_webhook.py
```

## 📚 完整文件

🔗 **詳細技術文件與流程圖：** https://www.notion.so/2a37a24cf64081dcbc11c8948ad10337

包含：
- 📊 系統架構流程圖（Mermaid）
- 🛠️ 技術棧詳解
- 🔧 部署步驟
- 💡 效能優化策略
- 🔐 安全性設計

## 🔑 環境變數

```bash
# LINE Bot 設定
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_CHANNEL_SECRET=your_secret

# TDX API 金鑰（至 https://tdx.transportdata.tw 申請）
CLIENT_ID=your_tdx_client_id
CLIENT_SECRET=your_tdx_client_secret
```

## 📋 授權條款

本專案採用 **CC BY-NC 4.0** 授權：

### ✅ 非商業使用（免費）
- 個人使用
- 教育用途
- 非營利組織
- 學習研究

### 💼 商業使用（需授權）
如需用於商業用途，請聯繫取得授權：
- 📧 Email: enorenor@gmail.com
- 💻 GitHub: [@coseto6125](https://github.com/coseto6125)

詳見 [LICENSE](LICENSE) 檔案。

## 🙏 致謝

- [TDX 運輸資料流通服務](https://tdx.transportdata.tw/) - 提供停車資料 API
- [LINE Developers](https://developers.line.biz/) - LINE Bot 平台

## 📞 聯絡方式

- 作者：coseto6125
- Email：enorenor@gmail.com
- GitHub：https://github.com/coseto6125/papaking

---

⭐ 如果這個專案對你有幫助，歡迎給個星星！
