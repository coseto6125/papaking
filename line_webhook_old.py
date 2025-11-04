"""
LINE Webhook 處理器 (Sanic 版本)
接收地理位置資訊，查詢附近停車場並回傳核心資訊
"""

import os
from datetime import datetime

import aiohttp
from linebot.v3 import WebhookHandler
from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    ApiClient,
    Configuration,
    MessagingApi,
    ReplyMessageRequest,
    TextMessage,
)
from linebot.v3.webhooks import LocationMessageContent, MessageEvent
from sanic import Sanic, text
from sanic.request import Request
from sanic.response import json as sanic_json

app = Sanic("LINE_Parking_Webhook")

# LINE Bot 設定
CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN", "YOUR_CHANNEL_ACCESS_TOKEN")
CHANNEL_SECRET = os.getenv("LINE_CHANNEL_SECRET", "YOUR_CHANNEL_SECRET")

# TDX API 設定
TDX_CLIENT_ID = os.getenv("CLIENT_ID", "XXXXX-XXXXXXXX-XXXX-XXXX")
TDX_CLIENT_SECRET = os.getenv("CLIENT_SECRET", "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX")

AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
BASE_URL_ADVANCED = "https://tdx.transportdata.tw/api/advanced/v1"

configuration = Configuration(access_token=CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(CHANNEL_SECRET)


def verify_signature(body: bytes, signature: str) -> bool:
    """驗證 LINE Webhook 簽名"""
    hmac.new(
        CHANNEL_SECRET.encode("utf-8"), body, hashlib.sha256
    ).digest()
    computed_signature = hmac.new(
        CHANNEL_SECRET.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, computed_signature)


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

    try:
        async with aiohttp.ClientSession() as session, session.post(LINE_REPLY_URL, headers=headers, json=payload) as response:
            if response.status == 200:
                app.ctx.logger.info("Reply sent successfully")
                return True
            error_text = await response.text()
            app.ctx.logger.error(f"Failed to send reply: {response.status} - {error_text}")
            return False
    except Exception as e:
        app.ctx.logger.exception(f"Error sending reply: {e}")
        return False
    """TDX 停車場查詢服務"""

    def __init__(self):
        self.access_token = None
        self.token_expires_at = None

    async def authenticate(self, session: aiohttp.ClientSession) -> str:
        """取得 TDX API access token"""
        data = {
            "grant_type": "client_credentials",
            "client_id": TDX_CLIENT_ID,
            "client_secret": TDX_CLIENT_SECRET,
        }

        async with session.post(AUTH_URL, data=data) as response:
            auth_json = await response.json()
            self.access_token = auth_json.get("access_token")
            return self.access_token

    def get_headers(self) -> dict:
        """取得 API 請求標頭"""
        if not self.access_token:
            raise ValueError("尚未認證，請先呼叫 authenticate()")
        return {"authorization": f"Bearer {self.access_token}", "Accept-Encoding": "gzip"}

    async def get_nearby_carparks(
        self, session: aiohttp.ClientSession, lat: float, lon: float, distance: int = 500, top: int = 10
    ) -> list[dict]:
        """查詢附近停車場"""
        url = f"{BASE_URL_ADVANCED}/Parking/OffStreet/CarPark/NearBy"
        params = {
            "$spatialFilter": f"nearby({lat},{lon},{distance})",
            "$format": "JSON",
            "$top": top,
        }

        async with session.get(url, headers=self.get_headers(), params=params) as response:
            return await response.json()

    def format_carpark_info(self, carpark: dict, index: int, distance_km: float | None = None) -> str:
        """格式化停車場資訊為精簡文字"""
        name = carpark.get("CarParkName", {}).get("Zh_tw", "未知停車場")
        address = carpark.get("Address", "無地址資訊")

        # 停車場類型
        carpark_type_map = {1: "平面", 2: "立體", 3: "地下", 4: "停車塔", 5: "機械式", 255: "未知"}
        carpark_type = carpark_type_map.get(carpark.get("CarParkType", 255), "未知")

        # 收費方式
        charge_type_map = {1: "計時", 2: "計次", 3: "月租", 4: "免費", 255: "未知"}
        charge_types = carpark.get("ChargeTypes", [])
        charge_str = "、".join([charge_type_map.get(ct, "未知") for ct in charge_types]) if charge_types else "未提供"

        # 特殊服務
        services = []
        if carpark.get("LiveOccuppancyAvailable") == 1:
            services.append("📊動態車位")
        if carpark.get("EVRechargingAvailable") == 1:
            services.append("⚡充電")
        if carpark.get("ReservationAvailable") == 1:
            services.append("📅預約")
        service_str = " ".join(services) if services else ""

        # 營運資訊
        is_public = "公有" if carpark.get("IsPublic") == 1 else "私有"

        # 聯絡電話
        telephone = carpark.get("Telephone", "")
        tel_str = f"\n📞 {telephone}" if telephone else ""

        # GPS 座標
        position = carpark.get("CarParkPosition", {})
        lat = position.get("PositionLat", 0)
        lon = position.get("PositionLon", 0)

        # 組合訊息
        distance_str = f" (約{distance_km:.1f}km)" if distance_km else ""
        return f"""
【{index}】{name}{distance_str}
🏗️ {carpark_type} | {is_public}
💰 {charge_str}
{service_str}
📮 {address}{tel_str}
📍 https://www.google.com/maps?q={lat},{lon}
""".strip()
    return None


# 全域服務實例
parking_service = TDXParkingService()


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """計算兩點間的距離（公里）使用 Haversine 公式"""
    from math import asin, cos, radians, sin, sqrt

    earth_radius = 6371  # 地球半徑（公里）

    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * asin(sqrt(a))

    return earth_radius * c


async def search_nearby_parking(latitude: float, longitude: float) -> str:
    """查詢附近停車場並格式化回應"""
    try:
        async with aiohttp.ClientSession() as session:
            # 認證
            await parking_service.authenticate(session)

            # 查詢附近停車場 (500 公尺內，前 10 筆)
            carparks = await parking_service.get_nearby_carparks(
                session=session, lat=latitude, lon=longitude, distance=500, top=10
            )

            if not carparks:
                return f"❌ 附近 500 公尺內找不到停車場\n📍 您的位置: ({latitude:.6f}, {longitude:.6f})"

            # 格式化回應訊息
            response = f"🅿️ 找到 {len(carparks)} 個停車場\n"
            response += f"📍 搜尋位置: ({latitude:.6f}, {longitude:.6f})\n"
            response += "🔍 搜尋範圍: 500 公尺\n"
            response += "=" * 30 + "\n\n"

            for idx, carpark in enumerate(carparks, 1):
                # 計算距離
                position = carpark.get("CarParkPosition", {})
                carpark_lat = position.get("PositionLat")
                carpark_lon = position.get("PositionLon")

                distance = None
                if carpark_lat and carpark_lon:
                    distance = calculate_distance(latitude, longitude, carpark_lat, carpark_lon)

                # 格式化停車場資訊
                info = parking_service.format_carpark_info(carpark, idx, distance)
                response += info + "\n\n"

            response += "=" * 30 + "\n"
            response += f"🕐 查詢時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

            return response

    except Exception as e:
        return f"❌ 查詢失敗: {e!s}\n請稍後再試或確認您的位置資訊是否正確。"


@app.post("/callback")
def callback(req: Request):
    """LINE Webhook 回呼端點"""
    # 取得 X-Line-Signature header
    signature = req.headers.get("X-Line-Signature", "")

    # 取得請求內容
    body = req.body.decode("utf-8")
    app.ctx.logger.info(f"Request body: {body}")

    # 驗證請求
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        app.ctx.logger.exception("Invalid signature. Please check your channel access token/channel secret.")
        return text("Invalid signature", status=400)

    return text("OK")


@handler.add(MessageEvent, message=LocationMessageContent)
def handle_location_message(event):
    """處理位置訊息"""
    location = event.message

    # 取得經緯度
    latitude = location.latitude
    longitude = location.longitude
    address = location.address if hasattr(location, "address") else "未提供地址"

    app.ctx.logger.info(f"Received location: lat={latitude}, lon={longitude}, address={address}")

    try:
        # 使用 Sanic 的事件循環查詢附近停車場
        import asyncio
        loop = asyncio.get_event_loop()
        response_text = loop.run_until_complete(search_nearby_parking(latitude, longitude))

        # 回覆訊息
        with ApiClient(configuration) as api_client:
            line_bot_api = MessagingApi(api_client)
            line_bot_api.reply_message_with_http_info(
                ReplyMessageRequest(reply_token=event.reply_token, messages=[TextMessage(text=response_text)])
            )

    except Exception:
        app.ctx.logger.exception("Error processing location")
        error_message = "處理位置資訊時發生錯誤，請稍後再試。"

        with ApiClient(configuration) as api_client:
            line_bot_api = MessagingApi(api_client)
            line_bot_api.reply_message_with_http_info(
                ReplyMessageRequest(reply_token=event.reply_token, messages=[TextMessage(text=error_message)])
            )


@app.get("/health")
def health_check(_request: Request):
    """健康檢查端點"""
    data = {"status": "healthy", "timestamp": datetime.now().isoformat()}
    return sanic_json(data)


@app.get("/")
def index(_request: Request):
    """首頁"""
    data = {
        "service": "LINE Parking Webhook (Sanic)",
        "version": "2.0.0",
        "framework": "Sanic",
        "description": "接收 LINE 地理位置訊息，查詢附近停車場資訊",
        "endpoints": {
            "webhook": "/callback",
            "health": "/health",
        },
    }
    return sanic_json(data)


@app.before_server_start
def setup_logger(app_instance, _loop):
    """設定日誌"""
    import logging

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    app_instance.ctx.logger = logging.getLogger("LINE_Webhook")


if __name__ == "__main__":
    # 檢查環境變數
    default_token = "YOUR_CHANNEL_ACCESS_TOKEN"  # noqa: S105
    default_secret = "YOUR_CHANNEL_SECRET"  # noqa: S105

    if default_token == CHANNEL_ACCESS_TOKEN:
        print("⚠️  警告: 請設定 LINE_CHANNEL_ACCESS_TOKEN 環境變數")
    if default_secret == CHANNEL_SECRET:
        print("⚠️  警告: 請設定 LINE_CHANNEL_SECRET 環境變數")
    if TDX_CLIENT_ID.startswith("XXXXX"):
        print("⚠️  警告: 請設定 CLIENT_ID 環境變數")
    if TDX_CLIENT_SECRET.startswith("XXXXXXXX"):
        print("⚠️  警告: 請設定 CLIENT_SECRET 環境變數")

    print("=" * 60)
    print("🚀 LINE Parking Webhook 服務啟動中...")
    print("=" * 60)
    print("📍 Webhook URL: http://localhost:5000/callback")
    print("💚 Health Check: http://localhost:5000/health")
    print("=" * 60)

    # 啟動 Flask 應用（生產環境請使用 gunicorn）
    app.run(host="0.0.0.0", port=8735, debug=False)  # noqa: S104
