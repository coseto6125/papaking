/**
 * LINE Webhook for Google Apps Script - 精簡版
 * 支援：停車場查詢、路邊停車格查詢
 */

// 設定區
const CONFIG = {
  LINE_CHANNEL_ACCESS_TOKEN: PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || 'YOUR_CHANNEL_ACCESS_TOKEN',
  TDX_CLIENT_ID: PropertiesService.getScriptProperties().getProperty('TDX_CLIENT_ID') || 'YOUR_TDX_CLIENT_ID',
  TDX_CLIENT_SECRET: PropertiesService.getScriptProperties().getProperty('TDX_CLIENT_SECRET') || 'YOUR_TDX_CLIENT_SECRET',
  AUTH_URL: 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
  BASE_URL: 'https://tdx.transportdata.tw/api/advanced/v1',
  LINE_REPLY_URL: 'https://api.line.me/v2/bot/message/reply'
};

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
      'Authorization': 'Bearer ' + CONFIG.LINE_CHANNEL_ACCESS_TOKEN
    },
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  try {
    var response = UrlFetchApp.fetch(CONFIG.LINE_REPLY_URL, options);
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
      client_id: CONFIG.TDX_CLIENT_ID,
      client_secret: CONFIG.TDX_CLIENT_SECRET
    },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(CONFIG.AUTH_URL, options);
  var data = JSON.parse(response.getContentText());
  return data.access_token;
}

// ==================== 停車場查詢 ====================

function searchNearbyParking(lat, lon) {
  try {
    var token = authenticateTDX();
    var url = CONFIG.BASE_URL + '/Parking/OffStreet/CarPark/NearBy';
    var query = '$spatialFilter=' + encodeURIComponent('nearby(' + lat + ',' + lon + ',1000)') + 
                '&$format=JSON&$top=5';
    
    var options = {
      method: 'get',
      headers: { 'authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url + '?' + query, options);
    var carparks = JSON.parse(response.getContentText());
    
    if (!carparks || carparks.length === 0) {
      return '❌ 附近找不到停車場';
    }
    
    var result = '';
    var displayCount = Math.min(carparks.length, 5);
    
    for (var i = 0; i < displayCount; i++) {
      var park = carparks[i];
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
    
    return result;
    
  } catch (error) {
    Logger.log('Parking error: ' + error);
    return '❌ 查詢失敗';
  }
}

// ==================== 路邊停車格查詢 ====================

function searchOnStreetParking(lat, lon) {
  try {
    var token = authenticateTDX();
    var url = CONFIG.BASE_URL + '/Parking/OnStreet/ParkingSegment/NearBy';
    var query = '$spatialFilter=' + encodeURIComponent('nearby(' + lat + ',' + lon + ',1000)') + 
                '&$format=JSON&$top=10';
    
    var options = {
      method: 'get',
      headers: { 'authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url + '?' + query, options);
    var segments = JSON.parse(response.getContentText());
    
    if (!segments || segments.length === 0) {
      return '❌ 附近找不到路邊停車格';
    }
    
    var result = '';
    var displayCount = Math.min(segments.length, 10);
    
    for (var i = 0; i < displayCount; i++) {
      var seg = segments[i];
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
    
    return result;
    
  } catch (error) {
    Logger.log('OnStreet error: ' + error);
    return '❌ 查詢失敗';
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
