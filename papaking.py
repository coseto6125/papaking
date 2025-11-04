import asyncio
import os
from typing import Literal

import aiohttp

app_id = os.getenv("CLIENT_ID", "XXXXX-XXXXXXXX-XXXX-XXXX")
app_key = os.getenv("CLIENT_SECRET", "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX")

AUTH_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
BASE_URL_ADVANCED = "https://tdx.transportdata.tw/api/advanced/v1"
BASE_URL_BASIC = "https://tdx.transportdata.tw/api/basic/v2"


class TDXAuth:
    """TDX API 認證類別"""

    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.access_token: str | None = None

    def get_auth_data(self) -> dict:
        """取得認證資料"""
        return {"grant_type": "client_credentials", "client_id": self.client_id, "client_secret": self.client_secret}

    async def authenticate(self, session: aiohttp.ClientSession) -> str:
        """執行認證並取得 access token"""
        async with session.post(AUTH_URL, data=self.get_auth_data()) as response:
            auth_json = await response.json()
            self.access_token = auth_json.get("access_token")
            return self.access_token

    def get_headers(self) -> dict:
        """取得 API 請求標頭"""
        if not self.access_token:
            raise ValueError("尚未認證，請先呼叫 authenticate()")
        return {"authorization": f"Bearer {self.access_token}", "Accept-Encoding": "gzip"}


class ParkingAPI:
    """停車資訊 API 客戶端"""

    def __init__(self, auth: TDXAuth):
        self.auth = auth
        self.base_url_advanced = BASE_URL_ADVANCED
        self.base_url_basic = BASE_URL_BASIC

    async def get_offstreet_carpark_nearby(
        self,
        session: aiohttp.ClientSession,
        lat: float,
        lon: float,
        distance: int = 100,
        top: int = 30,
        skip: int | None = None,
        select: str | None = None,
        filter_expr: str | None = None,
        orderby: str | None = None,
        format_type: Literal["JSON", "XML"] = "JSON",
    ) -> list[dict]:
        """
        取得指定位置附近的路外停車場資料

        Args:
            session: aiohttp ClientSession
            lat: 緯度 (WGS84)
            lon: 經度 (WGS84)
            distance: 搜尋半徑(公尺)，最大 1000
            top: 取前幾筆，預設 30
            skip: 跳過前幾筆
            select: OData $select 參數
            filter_expr: OData $filter 參數
            orderby: OData $orderby 參數
            format_type: 回傳格式 JSON 或 XML

        Returns:
            停車場資料列表
        """
        url = f"{self.base_url_advanced}/Parking/OffStreet/CarPark/NearBy"
        params = {
            "$spatialFilter": f"nearby({lat},{lon},{distance})",
            "$format": format_type,
            "$top": top,
        }

        if skip is not None:
            params["$skip"] = skip
        if select:
            params["$select"] = select
        if filter_expr:
            params["$filter"] = filter_expr
        if orderby:
            params["$orderby"] = orderby

        async with session.get(url, headers=self.auth.get_headers(), params=params) as response:
            return await response.json()

    async def get_onstreet_parkingspot_nearby(
        self,
        session: aiohttp.ClientSession,
        lat: float,
        lon: float,
        distance: int = 100,
        top: int = 30,
        skip: int | None = None,
        select: str | None = None,
        filter_expr: str | None = None,
        orderby: str | None = None,
        format_type: Literal["JSON", "XML"] = "JSON",
    ) -> list[dict]:
        """
        取得指定位置附近的路邊停車格資料

        Args:
            session: aiohttp ClientSession
            lat: 緯度 (WGS84)
            lon: 經度 (WGS84)
            distance: 搜尋半徑(公尺)，最大 1000
            top: 取前幾筆，預設 30
            skip: 跳過前幾筆
            select: OData $select 參數
            filter_expr: OData $filter 參數
            orderby: OData $orderby 參數
            format_type: 回傳格式 JSON 或 XML

        Returns:
            停車格資料列表
        """
        url = f"{self.base_url_advanced}/Parking/OnStreet/ParkingSpot/NearBy"
        params = {
            "$spatialFilter": f"nearby({lat},{lon},{distance})",
            "$format": format_type,
            "$top": top,
        }

        if skip is not None:
            params["$skip"] = skip
        if select:
            params["$select"] = select
        if filter_expr:
            params["$filter"] = filter_expr
        if orderby:
            params["$orderby"] = orderby

        async with session.get(url, headers=self.auth.get_headers(), params=params) as response:
            return await response.json()

    async def get_onstreet_parkingspot(
        self,
        session: aiohttp.ClientSession,
        city: str | None = None,
        top: int = 30,
        skip: int | None = None,
        select: str | None = None,
        filter_expr: str | None = None,
        orderby: str | None = None,
        format_type: Literal["JSON", "XML"] = "JSON",
    ) -> list[dict]:
        """
        取得路邊停車格基本資料

        Args:
            session: aiohttp ClientSession
            city: 城市代碼 (如: Taipei, NewTaipei, Taichung)
            top: 取前幾筆，預設 30
            skip: 跳過前幾筆
            select: OData $select 參數
            filter_expr: OData $filter 參數
            orderby: OData $orderby 參數
            format_type: 回傳格式 JSON 或 XML

        Returns:
            停車格資料列表
        """
        url = f"{self.base_url_basic}/Parking/OnStreet/ParkingSpot/{city}" if city else f"{self.base_url_basic}/Parking/OnStreet/ParkingSpot"

        params = {"$format": format_type, "$top": top}

        if skip is not None:
            params["$skip"] = skip
        if select:
            params["$select"] = select
        if filter_expr:
            params["$filter"] = filter_expr
        if orderby:
            params["$orderby"] = orderby

        async with session.get(url, headers=self.auth.get_headers(), params=params) as response:
            return await response.json()

    async def get_onstreet_parkingsegment(
        self,
        session: aiohttp.ClientSession,
        city: str | None = None,
        top: int = 30,
        skip: int | None = None,
        select: str | None = None,
        filter_expr: str | None = None,
        orderby: str | None = None,
        format_type: Literal["JSON", "XML"] = "JSON",
    ) -> list[dict]:
        """
        取得路邊停車路段基本資料

        Args:
            session: aiohttp ClientSession
            city: 城市代碼 (如: Taipei, NewTaipei, Taichung)
            top: 取前幾筆，預設 30
            skip: 跳過前幾筆
            select: OData $select 參數
            filter_expr: OData $filter 參數
            orderby: OData $orderby 參數
            format_type: 回傳格式 JSON 或 XML

        Returns:
            停車路段資料列表
        """
        if city:
            url = f"{self.base_url_basic}/Parking/OnStreet/ParkingSegment/{city}"
        else:
            url = f"{self.base_url_basic}/Parking/OnStreet/ParkingSegment"

        params = {"$format": format_type, "$top": top}

        if skip is not None:
            params["$skip"] = skip
        if select:
            params["$select"] = select
        if filter_expr:
            params["$filter"] = filter_expr
        if orderby:
            params["$orderby"] = orderby

        async with session.get(url, headers=self.auth.get_headers(), params=params) as response:
            return await response.json()


async def main():
    """示範使用範例"""
    # 台北車站座標
    taipei_station_lat = 25.047675
    taipei_station_lon = 121.517055

    async with aiohttp.ClientSession() as session:
        # 認證
        auth = TDXAuth(app_id, app_key)
        await auth.authenticate(session)
        if not auth.access_token:
            print("✗ 認證失敗，請檢查 Client ID 和 Client Secret 是否正確")
            return
        print(f"✓ 認證成功，Token: {auth.access_token[:20]}...")

        # 建立 API 客戶端
        parking_api = ParkingAPI(auth)

        # 查詢台北車站附近 500 公尺內的路外停車場（前 10 筆）
        print("\n" + "=" * 70)
        print("📍 查詢台北車站附近 500 公尺內的路外停車場...")
        print("=" * 70)
        off_street_data = await parking_api.get_offstreet_carpark_nearby(
            session=session, lat=taipei_station_lat, lon=taipei_station_lon, distance=500, top=10
        )
        print(f"✓ 找到 {len(off_street_data)} 個路外停車場\n")

        # 停車場類型對照
        carpark_type_map = {
            1: "平面",
            2: "立體",
            3: "地下",
            4: "立體停車塔",
            5: "立體機械式",
            6: "同時涵蓋2種以上",
            254: "其他",
            255: "未知",
        }

        # 停車導引類型對照
        guide_type_map = {
            1: "自行找尋停車位",
            2: "有導引輔助設施",
            3: "人工導引",
            4: "代客泊車",
            5: "混合型",
            254: "其他",
            255: "未知",
        }

        # 營運類型對照
        operation_type_map = {1: "公辦民營", 2: "公辦公營", 3: "私有民營"}

        # 收費方式對照
        charge_type_map = {1: "計時", 2: "計次", 3: "月租", 4: "免費", 254: "其他", 255: "未知"}

        for i, carpark in enumerate(off_street_data[:5], 1):
            print(f"\n{'=' * 70}")
            print(f"  路外停車場 #{i}")
            print(f"{'=' * 70}")

            # 基本資訊
            carpark_id = carpark.get("CarParkID", "未知")
            carpark_name = carpark.get("CarParkName", {})
            carpark_short_name = carpark.get("CarParkShortName", {})
            reg_no = carpark.get("CarParkRegNo", "未提供")

            print(f"  🆔 停車場 ID: {carpark_id}")
            print(f"  🏢 停車場名稱: {carpark_name.get('Zh_tw', '未知')} / {carpark_name.get('En', 'N/A')}")
            if carpark_short_name:
                print(f"  📛 停車場簡稱: {carpark_short_name.get('Zh_tw', '')} / {carpark_short_name.get('En', '')}")
            print(f"  📄 登記證號: {reg_no}")

            # 停車場類型與導引
            carpark_type = carpark.get("CarParkType", 255)
            carpark_type_name = carpark_type_map.get(carpark_type, "未知")
            guide_type = carpark.get("ParkingGuideType", 255)
            guide_type_name = guide_type_map.get(guide_type, "未知")

            print(f"  🏗️  停車場類型: {carpark_type_name} (代碼: {carpark_type})")
            print(f"  🚦 導引類型: {guide_type_name} (代碼: {guide_type})")

            # 位置資訊
            position = carpark.get("CarParkPosition", {})
            lat = position.get("PositionLat", "N/A")
            lon = position.get("PositionLon", "N/A")
            address = carpark.get("Address", "無地址")
            building_name = carpark.get("BuildingName")
            landmark = carpark.get("LandMark")

            print(f"  🌐 GPS 座標: ({lat}, {lon})")
            print(f"  📮 地址: {address}")
            if building_name:
                print(f"  🏢 所在大樓: {building_name}")
            if landmark:
                print(f"  🗺️  附近地標: {landmark}")

            geometry = carpark.get("Geometry")
            if geometry:
                print(f"  📐 停車場範圍 (WKT): {geometry[:50]}..." if len(geometry) > 50 else f"  📐 停車場範圍 (WKT): {geometry}")

            # 行政區資訊
            city = carpark.get("City", "未知")
            city_code = carpark.get("CityCode", "N/A")
            town_name = carpark.get("TownName", "未知")
            town_id = carpark.get("TownID", "N/A")
            print(f"  🏘️  行政區: {city} ({city_code}) - {town_name} ({town_id})")

            # 停車區域資訊
            parking_areas = carpark.get("ParkingAreas", [])
            if parking_areas:
                print(f"  📊 停車區域數: {len(parking_areas)}")
                for area_idx, area in enumerate(parking_areas[:3], 1):
                    area_id = area.get("ParkingAreaID", "N/A")
                    area_name = area.get("ParkingAreaName", {}).get("Zh_tw", "未知")
                    print(f"      區域{area_idx}: {area_name} (ID: {area_id})")

            # 車位資訊
            description = carpark.get("Description")
            if description:
                print(f"  📝 描述: {description}")

            # 收費資訊
            charge_types = carpark.get("ChargeTypes", [])
            if charge_types:
                charge_names = [charge_type_map.get(ct, f"未知({ct})") for ct in charge_types]
                print(f"  💰 收費方式: {', '.join(charge_names)}")

            fare_description = carpark.get("FareDescription")
            if fare_description:
                print(f"  💵 費率說明: {fare_description}")

            special_offer = carpark.get("SpecialOfferDescription")
            if special_offer:
                print(f"  🎁 優惠說明: {special_offer}")

            is_free_out_hours = carpark.get("IsFreeParkingOutOfHours", 0)
            if is_free_out_hours == 1:
                print("  ⏰ 營業時間外免費")

            # 營運資訊
            operation_type = carpark.get("OperationType", 255)
            operation_name = operation_type_map.get(operation_type, "未知")
            operator_id = carpark.get("OperatorID", "未知")
            is_public = carpark.get("IsPublic", 0)
            is_motorcycle = carpark.get("IsMotorcycle", 0)

            print(f"  🏛️  營運類型: {operation_name}")
            print(f"  👔 營運業者: {operator_id}")
            print(f"  🏢 所有權: {'公有' if is_public == 1 else '私有'}")
            print(f"  🏍️  機車停車場: {'是' if is_motorcycle == 1 else '否'}")

            # 服務與設施
            print("\n  ⚙️  服務與設施:")
            live_occupancy = carpark.get("LiveOccuppancyAvailable", 0)
            print(f"      📊 動態剩餘車位: {'有' if live_occupancy == 1 else '無'}")

            ev_recharging = carpark.get("EVRechargingAvailable", 0)
            print(f"      ⚡ 電動車充電: {'有' if ev_recharging == 1 else '無'}")

            monthly_ticket = carpark.get("MonthlyTicketAvailable", 0)
            print(f"      🎫 月票服務: {'有' if monthly_ticket == 1 else '無'}")

            season_ticket = carpark.get("SeasonTicketAvailable", 0)
            print(f"      🎫 季票服務: {'有' if season_ticket == 1 else '無'}")

            reservation = carpark.get("ReservationAvailable", 0)
            print(f"      📅 預約停車: {'有' if reservation == 1 else '無'}")
            if reservation == 1:
                reservation_url = carpark.get("ReservationURL")
                reservation_desc = carpark.get("ReservationDescription")
                if reservation_url:
                    print(f"          網址: {reservation_url}")
                if reservation_desc:
                    print(f"          說明: {reservation_desc}")

            wheelchair = carpark.get("WheelchairAccessible", 0)
            print(f"      ♿ 無障礙設施: {'有' if wheelchair == 1 else '無'}")

            overnight = carpark.get("OvernightPermitted", 0)
            print(f"      🌙 可過夜: {'可' if overnight == 1 else '不可'}")

            # 場內設施
            print("\n  🏢 場內設施:")
            ticket_machine = carpark.get("TicketMachine", 0)
            print(f"      🎰 自動售票機: {'有' if ticket_machine == 1 else '無'}")

            ticket_office = carpark.get("TicketOffice", 0)
            print(f"      🏪 售票處: {'有' if ticket_office == 1 else '無'}")

            toilet = carpark.get("Toilet", 0)
            print(f"      🚻 廁所: {'有' if toilet == 1 else '無'}")

            restaurant = carpark.get("Restaurant", 0)
            print(f"      🍴 餐廳: {'有' if restaurant == 1 else '無'}")

            gas_station = carpark.get("GasStation", 0)
            print(f"      ⛽ 加油站: {'有' if gas_station == 1 else '無'}")

            shop = carpark.get("Shop", 0)
            print(f"      🏪 商店: {'有' if shop == 1 else '無'}")

            # 安全設施
            print("\n  🔒 安全設施:")
            gated = carpark.get("Gated", 0)
            print(f"      🚧 閘口: {'有' if gated == 1 else '無'}")

            lighting = carpark.get("Lighting", 0)
            print(f"      💡 照明: {'有' if lighting == 1 else '無'}")

            secure_parking = carpark.get("SecureParking", 0)
            print(f"      🔐 停車安全保障: {'有' if secure_parking == 1 else '無'}")

            security_guard = carpark.get("SecurityGuard", 0)
            print(f"      👮 管理人員: {'有' if security_guard == 1 else '無'}")

            supervision = carpark.get("Supervision", 0)
            supervision_type = carpark.get("SupervisionType", 255)
            supervision_type_map = {1: "CCTV", 2: "CCTV和IVA", 254: "其他", 255: "未知"}
            print(f"      📹 監視系統: {'有' if supervision == 1 else '無'}", end="")
            if supervision == 1 and supervision_type != 255:
                print(f" ({supervision_type_map.get(supervision_type, '未知')})")
            else:
                print()

            hazardous = carpark.get("ProhibitedForAnyHazardousMaterialLoads", 0)
            print(f"      ☣️  禁止危險物品: {'是' if hazardous == 1 else '否'}")

            # 車輛限制
            vehicle_restriction = carpark.get("VehicleRestriction")
            if vehicle_restriction:
                print(f"\n  🚗 車輛限制: {vehicle_restriction}")

            # 聯絡資訊
            print("\n  📞 聯絡資訊:")
            telephone = carpark.get("Telephone", "未提供")
            print(f"      電話: {telephone}")

            emergency_phone = carpark.get("EmergencyPhone")
            if emergency_phone:
                print(f"      緊急電話: {emergency_phone}")

            email = carpark.get("Email", "未提供")
            print(f"      Email: {email}")

            web_url = carpark.get("WebURL")
            if web_url:
                print(f"      🌐 官網: {web_url}")

            fare_url = carpark.get("FareURL")
            if fare_url:
                print(f"      💰 票價網址: {fare_url}")

            location_map_url = carpark.get("LocationMapURL")
            if location_map_url:
                print(f"      🗺️  位置圖: {location_map_url}")

            # 圖片
            image_urls = carpark.get("ImageURLs", [])
            if image_urls:
                print(f"      📷 照片數: {len(image_urls)}")
                for img_idx, img_url in enumerate(image_urls[:2], 1):
                    print(f"          圖{img_idx}: {img_url}")

            # 更新時間
            update_time = carpark.get("UpdateTime")
            src_update_time = carpark.get("SrcUpdateTime")
            if update_time or src_update_time:
                print("\n  ⏰ 時間資訊:")
                if update_time:
                    print(f"      🕐 資料更新時間: {update_time}")
                if src_update_time:
                    print(f"      🕑 來源更新時間: {src_update_time}")

        # 查詢台北車站附近 300 公尺內的路邊停車格（前 10 筆）
        print("\n" + "=" * 70)
        print("📍 查詢台北車站附近 300 公尺內的路邊停車格...")
        print("=" * 70)
        parking_space_data = await parking_api.get_onstreet_parkingspot_nearby(
            session=session, lat=taipei_station_lat, lon=taipei_station_lon, distance=1000, top=10
        )
        print(f"✓ 找到 {len(parking_space_data)} 個路邊停車格")

        # 停車位類型對應
        space_type_map = {
            0: "所有停車位",
            1: "自小客車位",
            2: "機車位",
            3: "重型機車位",
            4: "腳踏車位",
            5: "大型車位",
            6: "小型巴士位",
            7: "孕婦及親子專用",
            8: "婦女車位",
            9: "身心障礙汽車",
            10: "身心障礙機車",
            11: "電動汽車",
            12: "電動機車",
            13: "復康巴士",
            14: "月租機車位",
            15: "月租汽車位",
            16: "季租機車位",
            17: "季租汽車位",
            18: "半年租機車位",
            19: "半年租汽車位",
            20: "年租機車位",
            21: "年租汽車位",
            22: "租賃機車位",
            23: "租賃汽車位",
            24: "卸貨車位",
            25: "計程車位",
            26: "夜間安心停車位",
            27: "臨時停車",
            28: "專用停車",
            29: "預約停車",
            254: "其他",
            255: "未知",
        }

        for i, spot in enumerate(parking_space_data[:5], 1):
            print(f"\n{'=' * 70}")
            print(f"  停車格 #{i}")
            print(f"{'=' * 70}")

            # 基本資訊
            spot_id = spot.get("ParkingSpotID", "未知")
            segment_id = spot.get("ParkingSegmentID", "未知")
            print(f"  🆔 停車格 ID: {spot_id}")
            print(f"  📍 所屬路段 ID: {segment_id}")

            # 位置資訊
            position = spot.get("Position", {})
            lat = position.get("PositionLat", "N/A")
            lon = position.get("PositionLon", "N/A")
            print(f"  🌐 GPS 座標: ({lat}, {lon})")

            geometry = spot.get("Geometry")
            if geometry:
                print(f"  📐 幾何資料 (WKT): {geometry[:50]}..." if len(geometry) > 50 else f"  📐 幾何資料 (WKT): {geometry}")

            # 車位規格
            space_type = spot.get("SpaceType", 255)
            space_type_name = space_type_map.get(space_type, f"未知類型({space_type})")
            print(f"  🚗 車位類型: {space_type_name} (代碼: {space_type})")

            length = spot.get("Length")
            width = spot.get("Width")
            if length is not None and width is not None:
                print(f"  📏 車位尺寸: 長 {length}m × 寬 {width}m (面積: {length * width:.2f}m²)")
            elif length is not None:
                print(f"  📏 車位長度: {length}m")
            elif width is not None:
                print(f"  📏 車位寬度: {width}m")
            else:
                print("  📏 車位尺寸: 未提供")

            # 設施資訊
            has_charging = spot.get("HasChargingPoint", 0)
            charging_icon = "⚡" if has_charging == 1 else "❌"
            charging_status = "有充電樁" if has_charging == 1 else "無充電樁"
            print(f"  {charging_icon} 充電設施: {charging_status}")

            # 道路連結
            link_id = spot.get("LinkID")
            if link_id:
                print(f"  🛣️  道路編碼: {link_id}")

            # 更新時間
            update_time = spot.get("UpdateTime")
            src_update_time = spot.get("SrcUpdateTime")
            update_interval = spot.get("UpdateInterval")

            if update_time:
                print(f"  🕐 資料更新時間: {update_time}")
            if src_update_time:
                print(f"  🕑 來源更新時間: {src_update_time}")
            if update_interval:
                print(f"  ⏱️  更新頻率: 每 {update_interval} 秒")

            # 授權單位
            authority_code = spot.get("AuthorityCode")
            authority_name = spot.get("AuthorityName")
            if authority_code or authority_name:
                print(f"  🏛️  管理單位: {authority_name or '未提供'} ({authority_code or 'N/A'})")

        # 查詢台北市路邊停車路段（前 5 筆）
        print("\n" + "=" * 70)
        print("\n📊 查詢台北市路邊停車路段資料...")
        taipei_segments = await parking_api.get_onstreet_parkingsegment(session=session, city="Taipei", top=5)
        print(f"✓ 取得 {len(taipei_segments)} 筆台北市路邊停車路段資料")

        # 收費類型對應
        pay_type_map = {1: "計時", 2: "計次", 3: "免費", 254: "其他", 255: "未知"}

        for i, segment in enumerate(taipei_segments[:3], 1):
            print(f"\n{'-' * 70}")
            print(f"  停車路段 #{i}")
            print(f"{'-' * 70}")

            segment_id = segment.get("ParkingSegmentID", "未知")
            segment_name = segment.get("ParkingSegmentName", {})
            road_section_name = segment.get("RoadSectionName", {})

            print(f"  🆔 路段 ID: {segment_id}")
            print(f"  📝 路段名稱: {segment_name.get('Zh_tw', '未知')} / {segment_name.get('En', 'N/A')}")
            print(f"  🛣️  道路名稱: {road_section_name.get('Zh_tw', '未知')} / {road_section_name.get('En', 'N/A')}")

            # 車位數量資訊
            total_spaces = segment.get("TotalSpaces", 0)
            remaining_spaces = segment.get("RemainingSpaces")
            print(f"  🅿️  總車位數: {total_spaces}")
            if remaining_spaces is not None:
                print(f"  ✅ 剩餘車位: {remaining_spaces}")
                print(
                    f"  📊 使用率: {((total_spaces - remaining_spaces) / total_spaces * 100):.1f}%" if total_spaces > 0 else "  📊 使用率: N/A"
                )

            # 收費資訊
            pay_type = segment.get("PayType", 255)
            pay_type_name = pay_type_map.get(pay_type, "未知")
            fare_description = segment.get("FareDescription")
            print(f"  💰 收費方式: {pay_type_name}")
            if fare_description:
                print(f"  💵 費率說明: {fare_description}")

            # 營業時間
            service_time = segment.get("ServiceTime")
            if service_time:
                print(f"  🕒 服務時間: {service_time}")

            # 地理資訊
            geometry = segment.get("Geometry")
            if geometry:
                print(f"  📐 路段範圍: {geometry[:60]}..." if len(geometry) > 60 else f"  📐 路段範圍: {geometry}")

            # 地址資訊
            address = segment.get("Address")
            city_code = segment.get("CityCode")
            town_name = segment.get("TownName")
            if address:
                print(f"  📮 地址: {address}")
            if city_code or town_name:
                print(f"  🏘️  行政區: {town_name or 'N/A'} (代碼: {city_code or 'N/A'})")

            # 更新時間
            update_time = segment.get("UpdateTime")
            src_update_time = segment.get("SrcUpdateTime")
            if update_time:
                print(f"  🕐 資料更新時間: {update_time}")
            if src_update_time:
                print(f"  🕑 來源更新時間: {src_update_time}")

            # 管理資訊
            operator_id = segment.get("OperatorID")
            authority_code = segment.get("AuthorityCode")
            if operator_id:
                print(f"  👔 營運業者: {operator_id}")
            if authority_code:
                print(f"  🏛️  主管機關: {authority_code}")

        # 輸出完整 JSON（可選）
        print("\n" + "=" * 70)
        print("\n💾 如需查看完整 JSON 資料，請取消下方註解：")
        # print(json.dumps(parking_space_data[0], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
