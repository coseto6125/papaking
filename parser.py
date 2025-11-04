"""
停車資訊解析器
用於解析和轉換 TDX 停車 API 回傳的資料
"""

from datetime import datetime


class ParkingDataParser:
    """停車資訊解析器"""

    def __init__(self):
        # 停車場類型對照
        self.carpark_type_map = {
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
        self.guide_type_map = {
            1: "自行找尋停車位",
            2: "有導引輔助設施",
            3: "人工導引",
            4: "代客泊車",
            5: "混合型",
            254: "其他",
            255: "未知",
        }

        # 營運類型對照
        self.operation_type_map = {1: "公辦民營", 2: "公辦公營", 3: "私有民營"}

        # 收費方式對照
        self.charge_type_map = {1: "計時", 2: "計次", 3: "月租", 4: "免費", 254: "其他", 255: "未知"}

        # 停車位類型對應（完整 30 種）
        self.space_type_map = {
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

        # 收費類型對應
        self.pay_type_map = {1: "計時", 2: "計次", 3: "免費", 254: "其他", 255: "未知"}

        # 停車類型對應
        self.parking_type_map = {
            1: "停車轉乘公共運輸",
            2: "臨時停車接送",
            3: "停車後轉使用公共自行車",
            4: "停車後步行",
            5: "活動專用停車場",
            6: "休息站專用停車場",
            7: "服務區專用停車場",
            8: "貨車及大型車停車場",
            9: "共享汽車租用服務停車場",
            10: "共乘服務停車場",
            254: "其他",
            255: "未知",
        }

        # 停車場服務類型對應
        self.parking_site_type_map = {
            1: "軌道場站",
            2: "機場場站",
            3: "船舶場站",
            4: "商圈",
            5: "餐廳",
            6: "運動場",
            7: "飯店",
            8: "觀光地標",
            9: "電影院",
            10: "觀光景點",
            11: "學校",
            12: "美術博物館",
            13: "展覽中心",
            14: "會議中心",
            15: "宗教機構",
            16: "賣場",
            17: "動物園",
            18: "高速公路",
            19: "政府部門",
            20: "住宅區",
            21: "夜市",
            22: "市場",
            23: "公園",
            254: "其他",
            255: "未知",
        }

    def parse_carpark(self, raw_data: dict) -> dict:
        """
        解析路外停車場資料

        Args:
            raw_data: TDX API 原始資料

        Returns:
            結構化的停車場資料
        """
        return {
            "type": "offstreet_carpark",
            "raw_id": raw_data.get("CarParkID"),
            "basic_info": self._parse_carpark_basic(raw_data),
            "location": self._parse_location(raw_data),
            "capacity": self._parse_carpark_capacity(raw_data),
            "charging": self._parse_charging_info(raw_data),
            "operation": self._parse_operation_info(raw_data),
            "services": self._parse_services(raw_data),
            "facilities": self._parse_facilities(raw_data),
            "security": self._parse_security(raw_data),
            "contact": self._parse_contact(raw_data),
            "metadata": self._parse_metadata(raw_data),
        }

    def parse_parking_spot(self, raw_data: dict) -> dict:
        """
        解析路邊停車格資料

        Args:
            raw_data: TDX API 原始資料

        Returns:
            結構化的停車格資料
        """
        return {
            "type": "parking_spot",
            "raw_id": raw_data.get("ParkingSpotID"),
            "basic_info": {
                "spot_id": raw_data.get("ParkingSpotID"),
                "segment_id": raw_data.get("ParkingSegmentID"),
            },
            "location": {
                "position": raw_data.get("Position"),
                "geometry": raw_data.get("Geometry"),
                "link_id": raw_data.get("LinkID"),
            },
            "specifications": self._parse_spot_specifications(raw_data),
            "facilities": {"has_charging_point": raw_data.get("HasChargingPoint") == 1},
            "authority": {
                "code": raw_data.get("AuthorityCode"),
                "name": raw_data.get("AuthorityName"),
            },
            "metadata": {
                "update_time": raw_data.get("UpdateTime"),
                "src_update_time": raw_data.get("SrcUpdateTime"),
                "update_interval": raw_data.get("UpdateInterval"),
            },
        }

    def parse_parking_segment(self, raw_data: dict) -> dict:
        """
        解析停車路段資料

        Args:
            raw_data: TDX API 原始資料

        Returns:
            結構化的停車路段資料
        """
        return {
            "type": "parking_segment",
            "raw_id": raw_data.get("ParkingSegmentID"),
            "basic_info": {
                "segment_id": raw_data.get("ParkingSegmentID"),
                "segment_name": raw_data.get("ParkingSegmentName"),
                "road_section_name": raw_data.get("RoadSectionName"),
            },
            "capacity": self._parse_segment_capacity(raw_data),
            "charging": {
                "pay_type": self._get_coded_value(raw_data.get("PayType"), self.pay_type_map),
                "fare_description": raw_data.get("FareDescription"),
                "service_time": raw_data.get("ServiceTime"),
            },
            "location": {
                "geometry": raw_data.get("Geometry"),
                "address": raw_data.get("Address"),
                "city_code": raw_data.get("CityCode"),
                "town_name": raw_data.get("TownName"),
            },
            "management": {
                "operator_id": raw_data.get("OperatorID"),
                "authority_code": raw_data.get("AuthorityCode"),
            },
            "metadata": {
                "update_time": raw_data.get("UpdateTime"),
                "src_update_time": raw_data.get("SrcUpdateTime"),
            },
        }

    def parse_batch(self, data_list: list[dict], data_type: str) -> list[dict]:
        """
        批次解析資料

        Args:
            data_list: 原始資料列表
            data_type: 資料類型 ('carpark', 'spot', 'segment')

        Returns:
            解析後的資料列表
        """
        parsers = {
            "carpark": self.parse_carpark,
            "spot": self.parse_parking_spot,
            "segment": self.parse_parking_segment,
        }

        parser = parsers.get(data_type)
        if not parser:
            raise ValueError(f"未知的資料類型: {data_type}")

        return [parser(item) for item in data_list]

    def _parse_carpark_basic(self, data: dict) -> dict:
        """解析停車場基本資訊"""
        return {
            "id": data.get("CarParkID"),
            "name": data.get("CarParkName"),
            "short_name": data.get("CarParkShortName"),
            "registration_number": data.get("CarParkRegNo"),
            "carpark_type": self._get_coded_value(data.get("CarParkType"), self.carpark_type_map),
            "guide_type": self._get_coded_value(data.get("ParkingGuideType"), self.guide_type_map),
            "description": data.get("Description"),
            "is_motorcycle": data.get("IsMotorcycle") == 1,
        }

    def _parse_location(self, data: dict) -> dict:
        """解析位置資訊"""
        return {
            "position": data.get("CarParkPosition"),
            "address": data.get("Address"),
            "building_name": data.get("BuildingName"),
            "landmark": data.get("LandMark"),
            "geometry": data.get("Geometry"),
            "city": data.get("City"),
            "city_code": data.get("CityCode"),
            "town_name": data.get("TownName"),
            "town_id": data.get("TownID"),
        }

    def _parse_carpark_capacity(self, data: dict) -> dict:
        """解析停車場容量資訊"""
        parking_areas = data.get("ParkingAreas", [])
        parking_types = [
            self._get_coded_value(pt, self.parking_type_map) for pt in data.get("ParkingTypes", [])
        ]
        parking_site_types = [
            self._get_coded_value(pst, self.parking_site_type_map) for pst in data.get("ParkingSiteTypes", [])
        ]

        return {
            "parking_areas": parking_areas,
            "parking_types": parking_types,
            "parking_site_types": parking_site_types,
        }

    def _parse_charging_info(self, data: dict) -> dict:
        """解析收費資訊"""
        charge_types = [self._get_coded_value(ct, self.charge_type_map) for ct in data.get("ChargeTypes", [])]

        return {
            "charge_types": charge_types,
            "fare_description": data.get("FareDescription"),
            "fare_url": data.get("FareURL"),
            "special_offer": data.get("SpecialOfferDescription"),
            "free_out_of_hours": data.get("IsFreeParkingOutOfHours") == 1,
        }

    def _parse_operation_info(self, data: dict) -> dict:
        """解析營運資訊"""
        return {
            "type": self._get_coded_value(data.get("OperationType"), self.operation_type_map),
            "operator_id": data.get("OperatorID"),
            "is_public": data.get("IsPublic") == 1,
        }

    def _parse_services(self, data: dict) -> dict:
        """解析服務資訊"""
        return {
            "live_occupancy": data.get("LiveOccuppancyAvailable") == 1,
            "ev_recharging": data.get("EVRechargingAvailable") == 1,
            "monthly_ticket": data.get("MonthlyTicketAvailable") == 1,
            "season_ticket": data.get("SeasonTicketAvailable") == 1,
            "reservation": {
                "available": data.get("ReservationAvailable") == 1,
                "url": data.get("ReservationURL"),
                "description": data.get("ReservationDescription"),
            },
            "wheelchair_accessible": data.get("WheelchairAccessible") == 1,
            "overnight_permitted": data.get("OvernightPermitted") == 1,
        }

    def _parse_facilities(self, data: dict) -> dict:
        """解析設施資訊"""
        return {
            "ticket_machine": data.get("TicketMachine") == 1,
            "ticket_office": data.get("TicketOffice") == 1,
            "toilet": data.get("Toilet") == 1,
            "restaurant": data.get("Restaurant") == 1,
            "gas_station": data.get("GasStation") == 1,
            "shop": data.get("Shop") == 1,
        }

    def _parse_security(self, data: dict) -> dict:
        """解析安全設施資訊"""
        supervision_type_map = {1: "CCTV", 2: "CCTV和IVA", 254: "其他", 255: "未知"}

        return {
            "gated": data.get("Gated") == 1,
            "lighting": data.get("Lighting") == 1,
            "secure_parking": data.get("SecureParking") == 1,
            "security_guard": data.get("SecurityGuard") == 1,
            "supervision": {
                "available": data.get("Supervision") == 1,
                "type": self._get_coded_value(data.get("SupervisionType"), supervision_type_map),
            },
            "hazardous_materials_prohibited": data.get("ProhibitedForAnyHazardousMaterialLoads") == 1,
            "vehicle_restriction": data.get("VehicleRestriction"),
        }

    def _parse_contact(self, data: dict) -> dict:
        """解析聯絡資訊"""
        return {
            "telephone": data.get("Telephone"),
            "emergency_phone": data.get("EmergencyPhone"),
            "email": data.get("Email"),
            "web_url": data.get("WebURL"),
            "location_map_url": data.get("LocationMapURL"),
            "images": data.get("ImageURLs", []),
        }

    def _parse_metadata(self, data: dict) -> dict:
        """解析元資料"""
        return {
            "update_time": data.get("UpdateTime"),
            "src_update_time": data.get("SrcUpdateTime"),
            "parsed_at": datetime.now().isoformat(),
        }

    def _parse_spot_specifications(self, data: dict) -> dict:
        """解析停車格規格"""
        length = data.get("Length")
        width = data.get("Width")
        area = length * width if length is not None and width is not None else None

        return {
            "space_type": self._get_coded_value(data.get("SpaceType"), self.space_type_map),
            "length": length,
            "width": width,
            "area": area,
        }

    def _parse_segment_capacity(self, data: dict) -> dict:
        """解析停車路段容量"""
        total = data.get("TotalSpaces", 0)
        remaining = data.get("RemainingSpaces")
        usage_rate = ((total - remaining) / total * 100) if remaining is not None and total > 0 else None

        return {
            "total_spaces": total,
            "remaining_spaces": remaining,
            "occupied_spaces": total - remaining if remaining is not None else None,
            "usage_rate": usage_rate,
        }

    def _get_coded_value(self, code: int | None, code_map: dict) -> dict:
        """取得編碼值及其對應名稱"""
        if code is None:
            return {"code": None, "name": None}
        return {"code": code, "name": code_map.get(code, f"未知({code})")}

    def create_summary(self, parsed_data: list[dict]) -> dict:
        """
        建立資料摘要

        Args:
            parsed_data: 解析後的資料列表

        Returns:
            資料摘要
        """
        summary = {
            "total_count": len(parsed_data),
            "data_types": {},
            "generated_at": datetime.now().isoformat(),
        }

        # 統計各類型數量
        for item in parsed_data:
            data_type = item.get("type", "unknown")
            summary["data_types"][data_type] = summary["data_types"].get(data_type, 0) + 1

        return summary


# 便利函數
def parse_tdx_parking_data(raw_data: list[dict], data_type: str) -> dict:
    """
    快速解析 TDX 停車 API 資料

    Args:
        raw_data: TDX API 原始資料列表
        data_type: 資料類型 ('carpark', 'spot', 'segment')

    Returns:
        包含解析資料和摘要的字典

    Example:
        >>> raw_carparks = [...] # TDX API 回傳的資料
        >>> result = parse_tdx_parking_data(raw_carparks, 'carpark')
        >>> print(result['summary'])
        >>> for item in result['data']:
        >>>     print(item['basic_info']['name'])
    """
    parser = ParkingDataParser()
    parsed_data = parser.parse_batch(raw_data, data_type)
    summary = parser.create_summary(parsed_data)

    return {"summary": summary, "data": parsed_data}


if __name__ == "__main__":
    # 測試範例
    print("停車資訊解析器 - 測試模式")
    print("=" * 60)

    # 測試停車場解析
    sample_carpark = {
        "CarParkID": "TEST001",
        "CarParkName": {"Zh_tw": "測試停車場", "En": "Test Parking"},
        "CarParkType": 2,
        "Address": "台北市中正區測試路1號",
        "IsPublic": 1,
        "LiveOccuppancyAvailable": 1,
    }

    parser = ParkingDataParser()
    parsed = parser.parse_carpark(sample_carpark)

    print("\n✓ 停車場解析測試:")
    print(f"  ID: {parsed['basic_info']['id']}")
    print(f"  名稱: {parsed['basic_info']['name']}")
    print(f"  類型: {parsed['basic_info']['carpark_type']['name']}")
    print(f"  地址: {parsed['location']['address']}")
    print(f"  公有: {parsed['operation']['is_public']}")

    print("\n" + "=" * 60)
    print("✅ Parser 測試完成！")
