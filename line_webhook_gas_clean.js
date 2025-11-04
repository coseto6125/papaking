/**
 * LINE Webhook for Google Apps Script
 * 接收地理位置資訊，查詢附近停車場並回傳核心資訊
 * 支援地址查詢路邊停車格
 */

// 設定區
const CONFIG = {
  LINE_CHANNEL_ACCESS_TOKEN: PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || 'YOUR_CHANNEL_ACCESS_TOKEN',
  LINE_CHANNEL_SECRET: PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_SECRET') || 'YOUR_CHANNEL_SECRET',
  TDX_CLIENT_ID: PropertiesService.getScriptProperties().getProperty('TDX_CLIENT_ID') || 'YOUR_TDX_CLIENT_ID',
  TDX_CLIENT_SECRET: PropertiesService.getScriptProperties().getProperty('TDX_CLIENT_SECRET') || 'YOUR_TDX_CLIENT_SECRET',
  AUTH_URL: 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
  BASE_URL_ADVANCED: 'https://tdx.transportdata.tw/api/advanced/v1',
  LINE_REPLY_URL: 'https://api.line.me/v2/bot/message/reply'
};

// ==================== LINE Webhook 處理 ====================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid request' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var webhookData = JSON.parse(e.postData.contents);
    var events = webhookData.events || [];

    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (event.type === 'message') {
        if (event.message.type === 'location') {
          handleLocationMessage(event);
        } else if (event.message.type === 'text') {
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

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  
  if (params.test === 'parking') {
    var lat = parseFloat(params.lat) || 25.063132;
    var lon = parseFloat(params.lon) || 121.500218;
    var result = searchNearbyParking(lat, lon);
    return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.TEXT);
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    service: 'LINE Parking Webhook',
    version: '2.0.0',
    platform: 'Google Apps Script',
    description: '接收 LINE 地理位置訊息或地址文字，查詢附近停車場/路邊停車格資訊',
    usage: {
      location: '傳送位置 → 查詢附近停車場',
      address: '傳送地址 → 查詢路邊停車格'
    }
  }, null, 2)).setMimeType(ContentService.MimeType.JSON);
}

function handleLocationMessage(event) {
  var replyToken = event.replyToken;
  var latitude = event.message.latitude;
  var longitude = event.message.longitude;
  
  // 只查詢停車場
  var responseText = searchNearbyParking(latitude, longitude);
  sendReplyMessage(replyToken, responseText);
}

function handleTextMessage(event) {
  var replyToken = event.replyToken;
  var userText = event.message.text;
  
  // 檢查是否為座標格式或地址
  var isCoordinate = /^\(?(-?\d+\.?\d*)\s*,?\s*(-?\d+\.?\d*)\)?$/.test(userText.trim());
  var isAddress = userText.includes('路') || userText.includes('街') || userText.includes('號');
  
  if (isCoordinate || isAddress) {
    var responseText = searchOnStreetParkingByAddress(userText);
    sendReplyMessage(replyToken, responseText);
  }
}

function sendReplyMessage(replyToken, textMessage) {
  var payload = {
    replyToken: replyToken,
    messages: [{ type: 'text', text: textMessage }]
  };
  
  var options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CONFIG.LINE_CHANNEL_ACCESS_TOKEN
    },
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    var response = UrlFetchApp.fetch(CONFIG.LINE_REPLY_URL, options);
    if (response.getResponseCode() === 200) {
      Logger.log('Reply sent successfully');
      return true;
    } else {
      Logger.log('Failed to send reply: ' + response.getResponseCode());
      return false;
    }
  } catch (error) {
    Logger.log('Error sending reply: ' + error.toString());
    return false;
  }
}

// ==================== TDX API 認證 ====================

function authenticateTDX() {
  var payload = {
    grant_type: 'client_credentials',
    client_id: CONFIG.TDX_CLIENT_ID,
    client_secret: CONFIG.TDX_CLIENT_SECRET
  };
  
  var options = {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(CONFIG.AUTH_URL, options);
  var authData = JSON.parse(response.getContentText());
  return authData.access_token;
}

// ==================== 停車場查詢（位置） ====================

function getNearbyCarparks(accessToken, lat, lon, distance, top) {
  distance = distance || 1000;
  top = top || 10;
  
  var url = CONFIG.BASE_URL_ADVANCED + '/Parking/OffStreet/CarPark/NearBy';
  var queryString = '$spatialFilter=' + encodeURIComponent('nearby(' + lat + ',' + lon + ',' + distance + ')') +
                    '&$format=JSON&$top=' + top;
  
  var options = {
    method: 'get',
    headers: { 'authorization': 'Bearer ' + accessToken },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url + '?' + queryString, options);
  return JSON.parse(response.getContentText());
}

function searchNearbyParking(latitude, longitude) {
  try {
    var accessToken = authenticateTDX();
    var carparks = getNearbyCarparks(accessToken, latitude, longitude, 1000, 10);
    
    if (!carparks || carparks.length === 0) {
      return '❌ 附近 1000 公尺內找不到停車場';
    }
    
    var response = '🅿️ 找到 ' + carparks.length + ' 個停車場\n';
    response += '📍 搜尋位置: (' + latitude.toFixed(6) + ', ' + longitude.toFixed(6) + ')\n';
    response += '🔍 搜尋範圍: 1000 公尺\n';
    response += '==============================\n\n';
    
    for (var i = 0; i < carparks.length; i++) {
      var carpark = carparks[i];
      var name = (carpark.CarParkName && carpark.CarParkName.Zh_tw) || '未知停車場';
      var address = carpark.Address || '無地址資訊';
      
      var position = carpark.CarParkPosition || {};
      var lat = position.PositionLat || 0;
      var lon = position.PositionLon || 0;
      
      var distance = calculateDistance(latitude, longitude, lat, lon);
      
      response += '【' + (i + 1) + '】' + name + ' (約' + distance.toFixed(1) + 'km)\n';
      response += '📮 ' + address + '\n';
      response += '📍 https://www.google.com/maps?q=' + lat + ',' + lon + '\n\n';
    }
    
    response += '==============================\n';
    response += '🕐 查詢時間: ' + Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
    
    return response;
    
  } catch (error) {
    Logger.log('Error: ' + error.toString());
    return '❌ 查詢失敗: ' + error.toString();
  }
}

// ==================== 路邊停車格查詢（地址） ====================

function getOnStreetParkingByCoordinate(accessToken, lat, lon, distance, top) {
  distance = distance || 500;
  top = top || 20;
  
  var url = CONFIG.BASE_URL_ADVANCED + '/Parking/OnStreet/ParkingSegment/NearBy';
  var queryString = '$spatialFilter=' + encodeURIComponent('nearby(' + lat + ',' + lon + ',' + distance + ')') +
                    '&$format=JSON&$top=' + top;
  
  var options = {
    method: 'get',
    headers: { 'authorization': 'Bearer ' + accessToken },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(url + '?' + queryString, options);
  var data = JSON.parse(response.getContentText());
  
  return data;
}

function getOnStreetParkingByAddress(accessToken, address, distance, top) {
  distance = distance || 500;
  top = top || 20;
  
  var geocode = geocodeAddress(address);
  var lat = geocode.lat;
  var lon = geocode.lon;
  
  var segments = getOnStreetParkingByCoordinate(accessToken, lat, lon, distance, top);
  
  return { segments: segments, geocode: geocode };
}

function searchOnStreetParkingByCoordinate(latitude, longitude) {
  try {
    var accessToken = authenticateTDX();
    var segments = getOnStreetParkingByCoordinate(accessToken, latitude, longitude, 1000, 10);
    
    if (!segments || segments.length === 0) {
      return '❌ 附近 1000 公尺內找不到路邊停車格';
    }
    
    var response = '🅿️ 找到 ' + segments.length + ' 個路邊停車區\n';
    response += '📍 搜尋位置: (' + latitude.toFixed(6) + ', ' + longitude.toFixed(6) + ')\n';
    response += '🔍 搜尋範圍: 1000 公尺\n';
    response += '==============================\n\n';
    
    for (var i = 0; i < Math.min(segments.length, 5); i++) {
      var segment = segments[i];
      var roadName = segment.RoadSectionName || '未知路段';
      var totalSpaces = segment.TotalSpaces || '未知';
      var chargeDesc = segment.ChargeDescription || '請查看路邊告示';
      
      var geometry = segment.Geometry || '';
      var mapLink = '';
      if (geometry) {
        var match = geometry.match(/LINESTRING\s*\(([^)]+)\)/i);
        if (match) {
          var coords = match[1].split(',')[0].trim().split(' ');
          if (coords.length >= 2) {
            var lon = parseFloat(coords[0]);
            var lat = parseFloat(coords[1]);
            var distance = calculateDistance(latitude, longitude, lat, lon);
            mapLink = '\n📍 https://www.google.com/maps?q=' + lat + ',' + lon;
            response += '【' + (i + 1) + '】' + roadName + ' (約' + distance.toFixed(1) + 'km)\n';
          }
        }
      } else {
        response += '【' + (i + 1) + '】' + roadName + '\n';
      }
      
      response += '🅿️ 共 ' + totalSpaces + ' 格\n';
      response += '💰 ' + chargeDesc + mapLink + '\n\n';
    }
    
    if (segments.length > 5) {
      response += '... 還有 ' + (segments.length - 5) + ' 個停車區\n';
    }
    
    return response;
    
  } catch (error) {
    Logger.log('Error: ' + error.toString());
    return '❌ 查詢失敗: ' + error.toString();
  }
}

function searchOnStreetParkingByAddress(address) {
  try {
    var accessToken = authenticateTDX();
    var result = getOnStreetParkingByAddress(accessToken, address, 500, 10);
    var segments = result.segments;
    var geocode = result.geocode;
    
    if (!segments || segments.length === 0) {
      return '❌ 附近 500 公尺內找不到路邊停車格\n📍 查詢地址: ' + address;
    }
    
    var response = '🅿️ 找到 ' + segments.length + ' 個路邊停車區\n';
    response += '📍 查詢地址: ' + address + '\n';
    response += '🗺️ 解析位置: ' + geocode.formatted_address + '\n';
    response += '🔍 搜尋範圍: 500 公尺\n';
    response += '==============================\n\n';
    
    for (var i = 0; i < Math.min(segments.length, 5); i++) {
      var segment = segments[i];
      var roadName = segment.RoadSectionName || '未知路段';
      var totalSpaces = segment.TotalSpaces || '未知';
      var chargeDesc = segment.ChargeDescription || '請查看路邊告示';
      
      var geometry = segment.Geometry || '';
      var mapLink = '';
      if (geometry) {
        var match = geometry.match(/LINESTRING\s*\(([^)]+)\)/i);
        if (match) {
          var coords = match[1].split(',')[0].trim().split(' ');
          if (coords.length >= 2) {
            var lon = parseFloat(coords[0]);
            var lat = parseFloat(coords[1]);
            var distance = calculateDistance(geocode.lat, geocode.lon, lat, lon);
            mapLink = '\n📍 https://www.google.com/maps?q=' + lat + ',' + lon;
            response += '【' + (i + 1) + '】' + roadName + ' (約' + distance.toFixed(1) + 'km)\n';
          }
        }
      } else {
        response += '【' + (i + 1) + '】' + roadName + '\n';
      }
      
      response += '🅿️ 共 ' + totalSpaces + ' 格\n';
      response += '💰 ' + chargeDesc + mapLink + '\n\n';
    }
    
    if (segments.length > 5) {
      response += '... 還有 ' + (segments.length - 5) + ' 個停車區\n';
    }
    
    return response;
    
  } catch (error) {
    Logger.log('Error: ' + error.toString());
    return '❌ 查詢失敗: ' + error.toString();
  }
}

// ==================== 地理編碼 ====================

function geocodeAddress(address) {
  // 檢查是否為座標格式：25.0631,121.5002 或 25.0631, 121.5002 或 (25.0631, 121.5002)
  var coordPattern = /^\(?(-?\d+\.?\d*)\s*,?\s*(-?\d+\.?\d*)\)?$/;
  var match = address.trim().match(coordPattern);
  
  if (match) {
    var lat = parseFloat(match[1]);
    var lon = parseFloat(match[2]);
    
    // 驗證座標範圍（台灣地區）
    if (lat >= 21 && lat <= 26 && lon >= 119 && lon <= 123) {
      Logger.log('Parsed coordinates: ' + lat + ', ' + lon);
      return {
        lat: lat,
        lon: lon,
        formatted_address: '座標 (' + lat.toFixed(6) + ', ' + lon.toFixed(6) + ')'
      };
    }
  }
  
  // 區域匹配
  var areaMap = {
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
  
  for (var area in areaMap) {
    if (address.includes(area)) {
      return {
        lat: areaMap[area].lat,
        lon: areaMap[area].lon,
        formatted_address: address
      };
    }
  }
  
  // 預設台北車站
  return {
    lat: 25.0478,
    lon: 121.5170,
    formatted_address: address + '（預設台北車站）'
  };
}

// ==================== 工具函數 ====================

function calculateDistance(lat1, lon1, lat2, lon2) {
  var earthRadius = 6371;
  var toRadians = function(degrees) { return degrees * Math.PI / 180; };
  
  var dLat = toRadians(lat2 - lat1);
  var dLon = toRadians(lon2 - lon1);
  
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  var c = 2 * Math.asin(Math.sqrt(a));
  return earthRadius * c;
}

// ==================== 測試函數 ====================

function testSearchParking() {
  var result = searchNearbyParking(25.063132, 121.500218);
  Logger.log(result);
}

function testSearchOnStreetParking() {
  var result = searchOnStreetParkingByAddress('新北市三重區重新路一段127號');
  Logger.log(result);
}

function testSearchOnStreetByCoordinate() {
  var result = searchOnStreetParkingByCoordinate(25.063132, 121.500218);
  Logger.log(result);
}

function testCoordinateInput() {
  // 測試各種座標格式
  var result1 = searchOnStreetParkingByAddress('25.0631,121.5002');
  Logger.log('格式1: ' + result1);
  
  var result2 = searchOnStreetParkingByAddress('25.0631, 121.5002');
  Logger.log('格式2: ' + result2);
  
  var result3 = searchOnStreetParkingByAddress('(25.0631, 121.5002)');
  Logger.log('格式3: ' + result3);
}

function testLocationMessage() {
  // 測試位置訊息回應（同時查詢停車場和路邊停車格）
  var parkingResult = searchNearbyParking(25.063132, 121.500218);
  // var onStreetResult = searchOnStreetParkingByCoordinate(25.063132, 121.500218);
  
  var combined = '📍 位置查詢結果\n\n' + 
                 '🏢 停車場資訊：\n' + parkingResult + 
                 '\n\n━━━━━━━━━━━━━━━━\n\n' +
                 '🚗 路邊停車格資訊：\n' + onStreetResult;
  
  Logger.log(combined);
}
