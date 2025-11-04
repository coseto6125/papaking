/**
 * LINE Webhook for Google Apps Script
 * 接收地理位置資訊，查詢附近停車場並回傳核心資訊
 */

// 設定區 - 請在 Apps Script 的屬性服務中設定這些值
// 或直接在這裡替換成你的值
const CONFIG = {
  LINE_CHANNEL_ACCESS_TOKEN: PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || 'YOUR_CHANNEL_ACCESS_TOKEN',
  LINE_CHANNEL_SECRET: PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_SECRET') || 'YOUR_CHANNEL_SECRET',
  TDX_CLIENT_ID: PropertiesService.getScriptProperties().getProperty('TDX_CLIENT_ID') || 'YOUR_TDX_CLIENT_ID',
  TDX_CLIENT_SECRET: PropertiesService.getScriptProperties().getProperty('TDX_CLIENT_SECRET') || 'YOUR_TDX_CLIENT_SECRET',
  AUTH_URL: 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
  BASE_URL_ADVANCED: 'https://tdx.transportdata.tw/api/advanced/v1',
  LINE_REPLY_URL: 'https://api.line.me/v2/bot/message/reply'
};


/**
 * LINE Webhook 進入點 (POST)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log('Invalid request');
      return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid request' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const body = e.postData.contents;
    Logger.log('Received body: ' + body);

    const webhookData = JSON.parse(body);
    const events = webhookData.events || [];

    for (const event of events) {
      if (event.type === 'message') {
        // 處理位置訊息
        if (event.message.type === 'location') {
          handleLocationMessage(event);
        }
        // 處理文字訊息（地址查詢）
        else if (event.message.type === 'text') {
          handleTextMessage(event);
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'OK' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('Error: ' + err);
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * GET 請求處理 (健康檢查)
 */
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    service: 'LINE Parking Webhook',
    version: '1.0.0',
    platform: 'Google Apps Script',
    description: '接收 LINE 地理位置訊息，查詢附近停車場資訊'
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 驗證 LINE Webhook 簽名
 */
function verifySignature(body, signature) {
  const hash = Utilities.computeHmacSha256Signature(body, CONFIG.LINE_CHANNEL_SECRET);
  const computedSignature = hash.map(byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
  return computedSignature === signature;
}

/**
 * 處理位置訊息
 */
function handleLocationMessage(event) {
  const replyToken = event.replyToken;
  const latitude = event.message.latitude;
  const longitude = event.message.longitude;
  const address = event.message.address || '未提供地址';
  
  Logger.log(`Location received: lat=${latitude}, lon=${longitude}, address=${address}`);
  
  const responseText = searchNearbyParking(latitude, longitude);
  sendReplyMessage(replyToken, responseText);
}

/**
 * 處理文字訊息（地址查詢路邊停車格）
 */
function handleTextMessage(event) {
  const replyToken = event.replyToken;
  const userText = event.message.text;
  
  Logger.log('Text received: ' + userText);
  
  // 檢查是否為地址查詢
  if (userText.includes('路') || userText.includes('街') || userText.includes('號')) {
    const responseText = searchOnStreetParkingByAddress(userText);
    sendReplyMessage(replyToken, responseText);
  }
}

/**
 * 發送 LINE 回覆訊息
 */
function sendReplyMessage(replyToken, textMessage) {
  const payload = {
    replyToken: replyToken,
    messages: [{
      type: 'text',
      text: textMessage
    }]
  };
  
  const options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(CONFIG.LINE_REPLY_URL, options);
    const statusCode = response.getResponseCode();
    
    if (statusCode === 200) {
      Logger.log('Reply sent successfully');
      return true;
    } else {
      Logger.log(`Failed to send reply: ${statusCode} - ${response.getContentText()}`);
      return false;
    }
  } catch (error) {
    Logger.log('Error sending reply: ' + error.toString());
    return false;
  }
}

/**
 * TDX API 認證
 */
function authenticateTDX() {
  const payload = {
    grant_type: 'client_credentials',
    client_id: CONFIG.TDX_CLIENT_ID,
    client_secret: CONFIG.TDX_CLIENT_SECRET
  };
  
  const options = {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(CONFIG.AUTH_URL, options);
    const authData = JSON.parse(response.getContentText());
    return authData.access_token;
  } catch (error) {
    Logger.log('Authentication failed: ' + error.toString());
    throw error;
  }
}

/**
 * 查詢附近停車場
 */
function getNearbyCarparks(accessToken, lat, lon, distance = 1000, top = 10) {
  const url = `${CONFIG.BASE_URL_ADVANCED}/Parking/OffStreet/CarPark/NearBy`;
  const params = {
    '$spatialFilter': `nearby(${lat},${lon},${distance})`,
    '$format': 'JSON',
    '$top': top
  };
  
  const queryString = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  
  const options = {
    method: 'get',
    headers: {
      'authorization': `Bearer ${accessToken}`,
      'Accept-Encoding': 'gzip'
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(`${url}?${queryString}`, options);
    return JSON.parse(response.getContentText());
  } catch (error) {
    Logger.log('Error fetching carparks: ' + error.toString());
    throw error;
  }
}

/**
 * 查詢附近路邊停車格（使用地址）
 */
function getOnStreetParkingByAddress(accessToken, address, distance = 500, top = 20) {
  // 先用 Google Geocoding API 將地址轉成座標
  const geocodeResult = geocodeAddress(address);
  
  if (!geocodeResult || !geocodeResult.lat || !geocodeResult.lon) {
    throw new Error('無法將地址轉換為座標');
  }
  
  const lat = geocodeResult.lat;
  const lon = geocodeResult.lon;
  
  Logger.log(`Geocoded: ${address} -> (${lat}, ${lon})`);
  
  // 查詢路邊停車格
  const url = `${CONFIG.BASE_URL_ADVANCED}/Parking/OnStreet/ParkingSegment/NearBy`;
  const params = {
    '$spatialFilter': `nearby(${lat},${lon},${distance})`,
    '$format': 'JSON',
    '$top': top
  };
  
  const queryString = Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
  
  const options = {
    method: 'get',
    headers: {
      'authorization': `Bearer ${accessToken}`,
      'Accept-Encoding': 'gzip'
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(`${url}?${queryString}`, options);
    const data = JSON.parse(response.getContentText());
    return {
      segments: data,
      geocode: geocodeResult
    };
  } catch (error) {
    Logger.log('Error fetching on-street parking: ' + error.toString());
    throw error;
  }
}

/**
 * 使用 Google Geocoding API 將地址轉換為座標
 */
function geocodeAddress(address) {
  try {
    // 使用 Google Maps Geocoding API
    const apiKey = PropertiesService.getScriptProperties().getProperty('GOOGLE_MAPS_API_KEY');
    
    if (!apiKey || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY') {
      // 如果沒有 API Key，使用簡單的台灣地址解析
      Logger.log('No Google Maps API Key, using fallback geocoding');
      return fallbackGeocode(address);
    }
    
    const url = 'https://maps.googleapis.com/maps/api/geocode/json';
    const params = {
      address: address,
      key: apiKey,
      region: 'tw'
    };
    
    const queryString = Object.keys(params)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    
    const response = UrlFetchApp.fetch(`${url}?${queryString}`);
    const data = JSON.parse(response.getContentText());
    
    if (data.status === 'OK' && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return {
        lat: location.lat,
        lon: location.lng,
        formatted_address: data.results[0].formatted_address
      };
    } else {
      Logger.log('Geocoding failed: ' + data.status);
      return fallbackGeocode(address);
    }
  } catch (error) {
    Logger.log('Geocoding error: ' + error.toString());
    return fallbackGeocode(address);
  }
}

/**
 * 備用的簡易地理編碼（使用 TDX API 或預設座標）
 */
function fallbackGeocode(address) {
  // 簡單的區域匹配（台北/新北市常見地點）
  const areaMap = {
    '台北': { lat: 25.0330, lon: 121.5654 },
    '信義區': { lat: 25.0330, lon: 121.5654 },
    '大安區': { lat: 25.0263, lon: 121.5436 },
    '中山區': { lat: 25.0636, lon: 121.5263 },
    '松山區': { lat: 25.0500, lon: 121.5770 },
    '新北': { lat: 25.0120, lon: 121.4650 },
    '三重區': { lat: 25.0631, lon: 121.5002 },
    '板橋區': { lat: 25.0122, lon: 121.4627 },
    '中和區': { lat: 24.9988, lon: 121.4987 },
    '永和區': { lat: 25.0038, lon: 121.5159 }
  };
  
  for (const area in areaMap) {
    if (address.includes(area)) {
      Logger.log(`Fallback geocode matched: ${area}`);
      return {
        lat: areaMap[area].lat,
        lon: areaMap[area].lon,
        formatted_address: address
      };
    }
  }
  
  // 預設台北車站
  Logger.log('Using default location: Taipei Station');
  return {
    lat: 25.0478,
    lon: 121.5170,
    formatted_address: '台北車站（預設）'
  };
}

/**
 * 計算兩點間距離 (Haversine 公式)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371; // 地球半徑（公里）
  
  const toRadians = (degrees) => degrees * Math.PI / 180;
  
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.asin(Math.sqrt(a));
  
  return earthRadius * c;
}

/**
 * 格式化路邊停車格資訊
 */
function formatParkingSegmentInfo(segment, index, distanceKm = null) {
  const roadName = segment.RoadSectionName || '未知路段';
  const roadSection = segment.RoadName || '';
  
  // 停車格類型
  const parkingTypeMap = {
    1: '平行',
    2: '垂直',
    3: '斜角',
    255: '未知'
  };
  const parkingType = parkingTypeMap[segment.ParkingType] || '未知';
  
  // 收費方式
  const chargeTypeMap = {
    1: '計時收費',
    2: '計次收費',
    3: '月租',
    4: '免費',
    255: '未知'
  };
  const chargeDesc = segment.ChargeDescription || '請查看路邊告示';
  
  // 停車格數量
  const totalSpaces = segment.TotalSpaces || '未知';
  
  // 營運時間
  const serviceStartTime = segment.ServiceStartTime || '';
  const serviceEndTime = segment.ServiceEndTime || '';
  const serviceTime = (serviceStartTime && serviceEndTime) 
    ? `${serviceStartTime} - ${serviceEndTime}` 
    : '全天';
  
  // GPS 座標
  const geometry = segment.Geometry || '';
  let mapLink = '';
  if (geometry) {
    // 解析 WKT LINESTRING
    const match = geometry.match(/LINESTRING\s*\(([^)]+)\)/i);
    if (match) {
      const coords = match[1].split(',')[0].trim().split(' ');
      if (coords.length >= 2) {
        const lon = parseFloat(coords[0]);
        const lat = parseFloat(coords[1]);
        mapLink = `\n📍 https://www.google.com/maps?q=${lat},${lon}`;
      }
    }
  }
  
  // 組合訊息
  const distanceStr = distanceKm !== null ? ` (約${distanceKm.toFixed(1)}km)` : '';
  
  return `【${index}】${roadName}${roadSection ? ' - ' + roadSection : ''}${distanceStr}
🅿️ ${parkingType}停車 | 共 ${totalSpaces} 格
💰 ${chargeDesc}
🕐 ${serviceTime}${mapLink}`;
}

/**
 * 查詢路邊停車格（依地址）
 */
function searchOnStreetParkingByAddress(address) {
  try {
    // 認證
    const accessToken = authenticateTDX();
    
    // 查詢路邊停車格
    const result = getOnStreetParkingByAddress(accessToken, address, 500, 20);
    const segments = result.segments;
    const geocode = result.geocode;
    
    if (!segments || segments.length === 0) {
      return `❌ 附近 500 公尺內找不到路邊停車格\n📍 查詢地址: ${address}\n🗺️ 解析位置: ${geocode.formatted_address}`;
    }
    
    // 格式化回應訊息
    let response = `🅿️ 找到 ${segments.length} 個路邊停車區\n`;
    response += `📍 查詢地址: ${address}\n`;
    response += `🗺️ 解析位置: ${geocode.formatted_address}\n`;
    response += `🔍 搜尋範圍: 500 公尺\n`;
    response += '==============================\n\n';
    
    for (let i = 0; i < Math.min(segments.length, 10); i++) {
      const segment = segments[i];
      
      // 計算距離
      const geometry = segment.Geometry || '';
      let distance = null;
      
      if (geometry) {
        const match = geometry.match(/LINESTRING\s*\(([^)]+)\)/i);
        if (match) {
          const coords = match[1].split(',')[0].trim().split(' ');
          if (coords.length >= 2) {
            const lon = parseFloat(coords[0]);
            const lat = parseFloat(coords[1]);
            distance = calculateDistance(geocode.lat, geocode.lon, lat, lon);
          }
        }
      }
      
      // 格式化停車格資訊
      const info = formatParkingSegmentInfo(segment, i + 1, distance);
      response += info + '\n\n';
    }
    
    if (segments.length > 10) {
      response += `... 還有 ${segments.length - 10} 個停車區\n\n`;
    }
    
    response += '==============================\n';
    response += `🕐 查詢時間: ${Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss')}`;
    
    return response;
    
  } catch (error) {
    Logger.log('Error searching on-street parking: ' + error.toString());
    return `❌ 查詢失敗: ${error.toString()}\n\n💡 請確認:\n1. 地址格式正確（例：新北市三重區重新路一段127號）\n2. TDX API 設定正確`;
  }
}

/**
 * 格式化停車場資訊
 */
function formatCarparkInfo(carpark, index, distanceKm = null) {
  const name = (carpark.CarParkName && carpark.CarParkName.Zh_tw) || '未知停車場';
  const address = carpark.Address || '無地址資訊';
  
  // 停車場類型
  const carparkTypeMap = {
    1: '平面',
    2: '立體',
    3: '地下',
    4: '停車塔',
    5: '機械式',
    255: '未知'
  };
  const carparkType = carparkTypeMap[carpark.CarParkType] || '未知';
  
  // 收費方式
  const chargeTypeMap = {
    1: '計時',
    2: '計次',
    3: '月租',
    4: '免費',
    255: '未知'
  };
  const chargeTypes = carpark.ChargeTypes || [];
  const chargeStr = chargeTypes.length > 0
    ? chargeTypes.map(ct => chargeTypeMap[ct] || '未知').join('、')
    : '未提供';
  
  // 特殊服務
  const services = [];
  if (carpark.LiveOccuppancyAvailable === 1) services.push('📊動態車位');
  if (carpark.EVRechargingAvailable === 1) services.push('⚡充電');
  if (carpark.ReservationAvailable === 1) services.push('📅預約');
  const serviceStr = services.length > 0 ? '\n' + services.join(' ') : '';
  
  // 營運資訊
  const isPublic = carpark.IsPublic === 1 ? '公有' : '私有';
  
  // 聯絡電話
  const telephone = carpark.Telephone || '';
  const telStr = telephone ? `\n📞 ${telephone}` : '';
  
  // GPS 座標
  const position = carpark.CarParkPosition || {};
  const lat = position.PositionLat || 0;
  const lon = position.PositionLon || 0;
  
  // 組合訊息
  const distanceStr = distanceKm !== null ? ` (約${distanceKm.toFixed(1)}km)` : '';
  
  return `【${index}】${name}${distanceStr}
🏗️ ${carparkType} | ${isPublic}
💰 ${chargeStr}${serviceStr}
📮 ${address}${telStr}
📍 https://www.google.com/maps?q=${lat},${lon}`;
}

/**
 * 查詢附近停車場並格式化回應
 */
function searchNearbyParking(latitude, longitude) {
  try {
    // 認證
    const accessToken = authenticateTDX();
    
    // 查詢附近停車場
    const carparks = getNearbyCarparks(accessToken, latitude, longitude, 1000, 10);
    
    if (!carparks || carparks.length === 0) {
      return `❌ 附近 1000 公尺內找不到停車場\n📍 您的位置: (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`;
    }
    
    // 格式化回應訊息
    let response = `🅿️ 找到 ${carparks.length} 個停車場\n`;
    response += `📍 搜尋位置: (${latitude.toFixed(6)}, ${longitude.toFixed(6)})\n`;
    response += '🔍 搜尋範圍: 1000 公尺\n';
    response += '==============================\n\n';
    
    for (let i = 0; i < carparks.length; i++) {
      const carpark = carparks[i];
      
      // 計算距離
      const position = carpark.CarParkPosition || {};
      const carparkLat = position.PositionLat;
      const carparkLon = position.PositionLon;
      
      let distance = null;
      if (carparkLat && carparkLon) {
        distance = calculateDistance(latitude, longitude, carparkLat, carparkLon);
      }
      
      // 格式化停車場資訊
      const info = formatCarparkInfo(carpark, i + 1, distance);
      response += info + '\n\n';
    }
    
    response += '==============================\n';
    response += `🕐 查詢時間: ${Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss')}`;
    
    return response;
    
  } catch (error) {
    Logger.log('Error searching nearby parking: ' + error.toString());
    return `❌ 查詢失敗: ${error.toString()}\n請稍後再試或確認您的位置資訊是否正確。`;
  }
}

/**
 * 測試函數 - 可在 Apps Script 編輯器中執行
 */
function testSearchParking() {
  const result = searchNearbyParking(25.063132, 121.500218);
  Logger.log(result);
}

/**
 * 測試路邊停車格查詢
 */
function testSearchOnStreetParking() {
  const result = searchOnStreetParkingByAddress('新北市三重區重新路一段127號');
  Logger.log(result);
}

/**
 * 測試地址轉座標
 */
function testGeocode() {
  const result = geocodeAddress('新北市三重區重新路一段127號');
  Logger.log(result);
}