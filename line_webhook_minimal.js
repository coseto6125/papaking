/**
 * LINE Webhook for Google Apps Script - 精簡版
 * 支援：停車場查詢、路邊停車格查詢
 */

// 設定區 - 請在指令碼屬性中設定這些值
var LINE_CHANNEL_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || 'YOUR_CHANNEL_ACCESS_TOKEN';
var TDX_CLIENT_ID = PropertiesService.getScriptProperties().getProperty('TDX_CLIENT_ID') || 'YOUR_TDX_CLIENT_ID';
var TDX_CLIENT_SECRET = PropertiesService.getScriptProperties().getProperty('TDX_CLIENT_SECRET') || 'YOUR_TDX_CLIENT_SECRET';

var AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
var BASE_URL = 'https://tdx.transportdata.tw/api/basic/v2';
var LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

// 啟動時檢查 BASE_URL
Logger.log('BASE_URL is: ' + BASE_URL);

// ==================== LINE Webhook ====================

function doPost(e) {
  try {
    if (!e || !e.postData) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid request' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var webhookData = JSON.parse(e.postData.contents);
    var events = webhookData.events || [];

    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (event.type === 'message' && event.message.type === 'location') {
        handleLocationMessage(event);
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

function handleLocationMessage(event) {
  var replyToken = event.replyToken;
  var latitude = event.message.latitude;
  var longitude = event.message.longitude;
  
  var parkingResult = searchNearbyParking(latitude, longitude);
  var onStreetResult = searchOnStreetParking(latitude, longitude);
  
  var responseText = '📍 停車資訊查詢結果\n\n' + 
                     '🏢 停車場 (1000m內)\n' + parkingResult + 
                     '\n━━━━━━━━━━━━━━━━\n\n' +
                     '🚗 路邊停車格 (500m內)\n' + onStreetResult;
  
  sendReplyMessage(replyToken, responseText);
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
      'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
    },
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    var response = UrlFetchApp.fetch(LINE_REPLY_URL, options);
    Logger.log('Reply status: ' + response.getResponseCode());
  } catch (error) {
    Logger.log('Error sending reply: ' + error.toString());
  }
}

// ==================== TDX API ====================

function authenticateTDX() {
  var options = {
    method: 'post',
    payload: {
      grant_type: 'client_credentials',
      client_id: TDX_CLIENT_ID,
      client_secret: TDX_CLIENT_SECRET
    },
    muteHttpExceptions: true
  };
  
  try {
    var response = UrlFetchApp.fetch(AUTH_URL, options);
    var statusCode = response.getResponseCode();
    var responseText = response.getContentText();
    
    Logger.log('TDX Auth Status: ' + statusCode);
    
    if (statusCode !== 200) {
      Logger.log('TDX Auth Error Response: ' + responseText);
      throw new Error('TDX authentication failed with status ' + statusCode);
    }
    
    var data = JSON.parse(responseText);
    
    if (!data.access_token) {
      Logger.log('TDX Auth Response (no token): ' + responseText);
      throw new Error('TDX response has no access_token');
    }
    
    return data.access_token;
    
  } catch (error) {
    Logger.log('TDX Auth Exception: ' + error.toString());
    throw error;
  }
}

// ==================== 停車場查詢 ====================

function searchNearbyParking(lat, lon) {
  try {
    var token = authenticateTDX();
    var url = BASE_URL + '/Parking/OffStreet/ParkingLots/NearBy';  // 全台查詢
    var query = 'lat=' + lat + '&lon=' + lon + '&distance=1000' + 
                '&$format=JSON&$top=5';
    
    var options = {
      method: 'get',
      headers: { 'authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    };
    
    Logger.log('Fetching parking from: ' + url + '?' + query);
    
    var response = UrlFetchApp.fetch(url + '?' + query, options);
    var statusCode = response.getResponseCode();
    var responseText = response.getContentText();
    
    Logger.log('Parking API Status: ' + statusCode);
    
    if (statusCode === 404) {
      Logger.log('Parking API 404: Resource Not Found');
      return '目前沒有查詢到停車場';
    }
    
    if (statusCode !== 200) {
      Logger.log('Parking API Error: ' + responseText);
      return '❌ API 回應錯誤 (狀態碼: ' + statusCode + ')';
    }
    
    var carparks = JSON.parse(responseText);
    
    Logger.log('Parking carparks type: ' + typeof carparks);
    Logger.log('Parking carparks is Array: ' + Array.isArray(carparks));
    Logger.log('Parking carparks length: ' + (carparks ? carparks.length : 'null'));
    
    // 確保 carparks 是陣列
    if (!carparks || !Array.isArray(carparks) || carparks.length === 0) {
      return '目前沒有查詢到停車場';
    }
    
    var result = '';
    var displayCount = Math.min(carparks.length, 5);
    
    Logger.log('Parking displayCount: ' + displayCount);
    
    for (var i = 0; i < displayCount; i++) {
      var park = carparks[i];
      
      if (!park) {
        Logger.log('Parking lot ' + i + ' is null/undefined');
        continue;
      }
      
      var name = (park.CarParkName && park.CarParkName.Zh_tw) || '未知';
      var address = park.Address || '無地址';
      var position = park.CarParkPosition || {};
      var parkLat = position.PositionLat || 0;
      var parkLon = position.PositionLon || 0;
      var distance = calculateDistance(lat, lon, parkLat, parkLon);
      
      result += '【' + (i + 1) + '】' + name + ' (' + distance.toFixed(1) + 'km)\n';
      result += '📮 ' + address + '\n';
      result += '📍 maps.google.com/?q=' + parkLat + ',' + parkLon + '\n\n';
    }
    
    // 如果 result 還是空的（理論上不應該發生）
    if (!result || result.trim() === '') {
      Logger.log('Parking result is empty after processing');
      return '目前沒有查詢到停車場';
    }
    
    return result;
    
  } catch (error) {
    Logger.log('Parking error: ' + error);
    return '❌ 查詢失敗: ' + error.toString();
  }
}

// ==================== 路邊停車格查詢 ====================

function searchOnStreetParking(lat, lon) {
  try {
    var token = authenticateTDX();
    var url = BASE_URL + '/Parking/OnStreet/ParkingSpace/NearBy';  // 全台查詢
    var query = 'lat=' + lat + '&lon=' + lon + '&distance=1000' + 
                '&$format=JSON&$top=10';
    
    var options = {
      method: 'get',
      headers: { 'authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    };
    
    Logger.log('Fetching on-street from: ' + url + '?' + query);
    
    var response = UrlFetchApp.fetch(url + '?' + query, options);
    var statusCode = response.getResponseCode();
    var responseText = response.getContentText();
    
    Logger.log('OnStreet API Status: ' + statusCode);
    
    if (statusCode === 404) {
      Logger.log('OnStreet API 404: Resource Not Found');
      return '目前沒有查詢到路邊停車格';
    }
    
    if (statusCode !== 200) {
      Logger.log('OnStreet API Error: ' + responseText);
      return '❌ API 回應錯誤 (狀態碼: ' + statusCode + ')';
    }
    
    var segments = JSON.parse(responseText);
    
    Logger.log('OnStreet segments type: ' + typeof segments);
    Logger.log('OnStreet segments is Array: ' + Array.isArray(segments));
    Logger.log('OnStreet segments length: ' + (segments ? segments.length : 'null'));
    
    // 確保 segments 是陣列
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return '目前沒有查詢到路邊停車格';
    }
    
    var result = '';
    var displayCount = Math.min(segments.length, 10);
    
    Logger.log('OnStreet displayCount: ' + displayCount);
    
    for (var i = 0; i < displayCount; i++) {
      var seg = segments[i];
      
      if (!seg) {
        Logger.log('OnStreet segment ' + i + ' is null/undefined');
        continue;
      }
      
      var roadName = seg.RoadSectionName || '未知路段';
      var spaces = seg.TotalSpaces || '?';
      var charge = seg.ChargeDescription || '請查看告示';
      
      // 解析座標
      var geometry = seg.Geometry || '';
      var segLat = 0, segLon = 0;
      var match = geometry.match(/LINESTRING\s*\(([^)]+)\)/i);
      if (match) {
        var coords = match[1].split(',')[0].trim().split(' ');
        if (coords.length >= 2) {
          segLon = parseFloat(coords[0]);
          segLat = parseFloat(coords[1]);
        }
      }
      
      var distance = calculateDistance(lat, lon, segLat, segLon);
      
      result += '【' + (i + 1) + '】' + roadName + ' (' + distance.toFixed(1) + 'km)\n';
      result += '🅿️ ' + spaces + ' 格 | ' + charge + '\n';
      if (segLat && segLon) {
        result += '📍 maps.google.com/?q=' + segLat + ',' + segLon + '\n';
      }
      result += '\n';
    }
    
    // 如果 result 還是空的（理論上不應該發生）
    if (!result || result.trim() === '') {
      Logger.log('OnStreet result is empty after processing');
      return '目前沒有查詢到路邊停車格';
    }
    
    return result;
    
  } catch (error) {
    Logger.log('OnStreet error: ' + error);
    return '❌ 查詢失敗: ' + error.toString();
  }
}

// ==================== 工具函數 ====================

function calculateDistance(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var toRad = function(deg) { return deg * Math.PI / 180; };
  var dLat = toRad(lat2 - lat1);
  var dLon = toRad(lon2 - lon1);
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
  var c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

// ==================== 測試函數 ====================

/**
 * 測試路邊停車格查詢
 * 使用台北車站座標
 */
function testOnStreetParking() {
  var lat = 25.047924;
  var lon = 121.517081;
  
  Logger.log('=== 測試路邊停車格查詢 ===');
  Logger.log('座標: ' + lat + ', ' + lon + ' (台北車站)');
  
  var result = searchOnStreetParking(lat, lon);
  Logger.log(result);
  Logger.log('=== 測試完成 ===');
  
  return result;
}

/**
 * 測試停車場查詢
 * 使用台北車站座標
 */
function testParkingLot() {
  var lat = 25.047924;
  var lon = 121.517081;
  
  Logger.log('=== 測試停車場查詢 ===');
  Logger.log('座標: ' + lat + ', ' + lon + ' (台北車站)');
  
  var result = searchNearbyParking(lat, lon);
  Logger.log(result);
  Logger.log('=== 測試完成 ===');
  
  return result;
}

/**
 * 測試完整回覆（模擬 LINE 位置訊息）
 * 使用台北車站座標
 */
function testFullResponse() {
  var lat = 25.047924;
  var lon = 121.517081;
  
  Logger.log('=== 測試完整回覆 ===');
  Logger.log('座標: ' + lat + ', ' + lon + ' (台北車站)');
  
  var onStreetResult = searchOnStreetParking(lat, lon);
  var parkingResult = searchNearbyParking(lat, lon);
  
  var responseText = '📍 停車資訊查詢結果\n\n' + 
                     '🚗 路邊停車格 (1000m內)\n' + onStreetResult + 
                     '\n━━━━━━━━━━━━━━━━\n\n' +
                     '🏢 停車場 (1000m內)\n' + parkingResult;
  
  Logger.log(responseText);
  Logger.log('=== 測試完成 ===');
  
  return responseText;
}

/**
 * 測試 TDX API 認證
 */
function testAuthentication() {
  Logger.log('=== 測試 TDX API 認證 ===');
  
  try {
    var token = authenticateTDX();
    
    if (token && token.length > 0) {
      Logger.log('✅ 認證成功');
      Logger.log('Token 長度: ' + token.length);
      Logger.log('Token 前10字元: ' + token.substring(0, 10) + '...');
      return true;
    } else {
      Logger.log('❌ 認證失敗: Token 為空');
      return false;
    }
  } catch (error) {
    Logger.log('❌ 認證失敗: ' + error.toString());
    return false;
  }
}

/**
 * 測試距離計算
 */
function testDistanceCalculation() {
  Logger.log('=== 測試距離計算 ===');
  
  // 台北車站到台北101
  var lat1 = 25.047924;
  var lon1 = 121.517081;
  var lat2 = 25.033964;
  var lon2 = 121.564472;
  
  var distance = calculateDistance(lat1, lon1, lat2, lon2);
  
  Logger.log('起點: 台北車站 (' + lat1 + ', ' + lon1 + ')');
  Logger.log('終點: 台北101 (' + lat2 + ', ' + lon2 + ')');
  Logger.log('距離: ' + distance.toFixed(2) + ' km');
  Logger.log('預期: 約 4.5 km');
  
  return distance;
}

/**
 * 測試不同地點
 * 可自訂座標
 */
function testCustomLocation() {
  // 修改這裡的座標來測試不同地點
  var lat = 25.063132;  // 預設：中山區
  var lon = 121.500218;
  
  Logger.log('=== 測試自訂地點 ===');
  Logger.log('座標: ' + lat + ', ' + lon);
  
  var result = testFullResponse();
  
  return result;
}

/**
 * 執行所有測試
 */
function runAllTests() {
  Logger.log('========================================');
  Logger.log('開始執行所有測試');
  Logger.log('========================================\n');
  
  // 測試 1: API 認證
  testAuthentication();
  Logger.log('\n');
  
  // 測試 2: 距離計算
  testDistanceCalculation();
  Logger.log('\n');
  
  // 測試 3: 路邊停車格
  testOnStreetParking();
  Logger.log('\n');
  
  // 測試 4: 停車場
  testParkingLot();
  Logger.log('\n');
  
  // 測試 5: 完整回覆
  testFullResponse();
  Logger.log('\n');
  
  Logger.log('========================================');
  Logger.log('所有測試完成');
  Logger.log('========================================');
}

