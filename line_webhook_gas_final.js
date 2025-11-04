/**
 * LINE Webhook for Google Apps Script - 最終版
 * 全台停車資訊查詢
 */

// ========== 設定區 ==========
// 請在 Google Apps Script 的「專案設定 > 指令碼屬性」中設定這些值

var LINE_CHANNEL_ACCESS_TOKEN = 'REDACTED_LINE_CHANNEL_ACCESS_TOKEN'
var LINE_CHANNEL_SECRET = 'REDACTED_LINE_CHANNEL_SECRET'
var TDX_CLIENT_ID = 'REDACTED_TDX_CLIENT_ID'
var TDX_CLIENT_SECRET = 'REDACTED_TDX_CLIENT_SECRET'
var AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token'
var BASE_URL = 'https://tdx.transportdata.tw/api/advanced/v1'
var LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'



// ========== LINE Webhook ==========

function doPost(e) {
  try {
    if (!e || !e.postData) {
      return ContentService.createTextOutput('Invalid request').setMimeType(ContentService.MimeType.TEXT);
    }

    var data = JSON.parse(e.postData.contents);
    var events = data.events || [];

    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      if (event.type === 'message' && event.message.type === 'location') {
        handleLocation(event);
      }
    }

    return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return ContentService.createTextOutput('Error').setMimeType(ContentService.MimeType.TEXT);
  }
}

function handleLocation(event) {
  var lat = event.message.latitude;
  var lon = event.message.longitude;
  var replyToken = event.replyToken;
  
  Logger.log('查詢座標: ' + lat + ', ' + lon);
  
  var onStreet = queryOnStreet(lat, lon);
  var parking = queryParking(lat, lon);
  
  var msg = '📍 停車資訊查詢結果\n\n' +
            '🚗 路邊停車格 (1000m內)\n' + onStreet +
            '\n━━━━━━━━━━━━━━━━\n\n' +
            '🏢 停車場 (1000m內)\n' + parking;
  
  replyLine(replyToken, msg);
}

function replyLine(token, text) {
  // 直接使用全域變數
  var options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
    },
    payload: JSON.stringify({
      replyToken: token,
      messages: [{ type: 'text', text: text }]
    }),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(LINE_REPLY_URL, options);
}

// ========== TDX API ==========

function getTDXToken() {
  // 直接使用全域變數
  var options = {
    method: 'post',
    payload: {
      grant_type: 'client_credentials',
      client_id: TDX_CLIENT_ID,
      client_secret: TDX_CLIENT_SECRET
    },
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(config.AUTH_URL, options);
  var data = JSON.parse(response.getContentText());
  return data.access_token;
}

function queryOnStreet(lat, lon) {
  try {
    // 直接使用全域變數
    var token = getTDXToken();
    var url = BASE_URL + '/Parking/OnStreet/ParkingSpot/NearBy';
    var query = '?$spatialFilter=' + encodeURIComponent('nearby(' + lat + ',' + lon + ',1000)') + 
                '&$format=JSON&$top=10';
    
    Logger.log('路邊停車格 URL: ' + url + query);
    
    var options = {
      method: 'get',
      headers: { 'authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url + query, options);
    var status = response.getResponseCode();
    
    Logger.log('路邊停車格狀態: ' + status);
    
    if (status === 404) {
      return '目前沒有查詢到路邊停車格';
    }
    
    if (status !== 200) {
      return '❌ 查詢錯誤 (狀態: ' + status + ')';
    }
    
    var items = JSON.parse(response.getContentText());
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return '目前沒有查詢到路邊停車格';
    }
    
    // 只保留小客車停車格 (SpaceType = 1)
    var carSpots = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].SpaceType === 1) {
        carSpots.push(items[i]);
      }
    }
    
    if (carSpots.length === 0) {
      return '目前沒有查詢到小客車停車格';
    }
    
    // 將停車格依 ParkingSegmentID 群組
    var segments = {};
    for (var i = 0; i < carSpots.length; i++) {
      var item = carSpots[i];
      var segId = item.ParkingSegmentID || 'unknown';
      
      if (!segments[segId]) {
        segments[segId] = {
          spots: [],
          position: item.Position
        };
      }
      segments[segId].spots.push(item);
    }
    
    // 顯示各路段
    var result = '';
    var segmentList = Object.keys(segments);
    var displayCount = Math.min(segmentList.length, 10);
    
    for (var i = 0; i < displayCount; i++) {
      var segId = segmentList[i];
      var seg = segments[segId];
      var spotCount = seg.spots.length;
      var pos = seg.position;
      
      // 取得地址（粗略）
      var address = '';
      if (pos && pos.PositionLat && pos.PositionLon) {
        address = getAddressFromCoords(pos.PositionLat, pos.PositionLon);
      }
      
      result += '【' + (i + 1) + '】';
      if (address) {
        result += address + '\n';
        result += '路段 ' + segId + '\n';
      } else {
        result += '路段 ' + segId + '\n';
      }
      
      result += '🅿️ 共 ' + spotCount + ' 格（小客車）\n';
      
      if (pos && pos.PositionLat && pos.PositionLon) {
        var distance = calculateDistance(lat, lon, pos.PositionLat, pos.PositionLon);
        result += '📍 ' + distance.toFixed(2) + 'km\n';
        result += '🗺️ https://www.google.com/maps?q=' + pos.PositionLat + ',' + pos.PositionLon;
      }
      result += '\n\n';
    }
    
    if (segmentList.length > 10) {
      result += '... 還有 ' + (segmentList.length - 10) + ' 個路段\n';
    }
    
    return result || '目前沒有查詢到路邊停車格';
    
  } catch (err) {
    Logger.log('路邊停車格錯誤: ' + err);
    return '❌ 查詢失敗';
  }
}

function queryParking(lat, lon) {
  try {
    // 直接使用全域變數
    var token = getTDXToken();
    var url = BASE_URL + '/Parking/OffStreet/CarPark/NearBy';
    var query = '?$spatialFilter=' + encodeURIComponent('nearby(' + lat + ',' + lon + ',1000)') + 
                '&$format=JSON&$top=5';
    
    Logger.log('停車場 URL: ' + url + query);
    
    var options = {
      method: 'get',
      headers: { 'authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url + query, options);
    var status = response.getResponseCode();
    
    Logger.log('停車場狀態: ' + status);
    
    if (status === 404) {
      return '目前沒有查詢到停車場';
    }
    
    if (status !== 200) {
      return '❌ 查詢錯誤 (狀態: ' + status + ')';
    }
    
    var items = JSON.parse(response.getContentText());
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return '目前沒有查詢到停車場';
    }
    
    var result = '';
    for (var i = 0; i < Math.min(items.length, 5); i++) {
      var item = items[i];
      var name = (item.CarParkName && item.CarParkName.Zh_tw) || '未知';
      var address = item.Address || '無地址';
      
      result += '【' + (i + 1) + '】' + name + '\n';
      result += '📮 ' + address + '\n\n';
    }
    
    return result || '目前沒有查詢到停車場';
    
  } catch (err) {
    Logger.log('停車場錯誤: ' + err);
    return '❌ 查詢失敗';
  }
}

// ========== 測試函數 ==========

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

function getAddressFromCoords(lat, lon) {
  try {
    // 使用 BigDataCloud (免費、無需 API Key、較快)
    var url = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=zh';
    
    var options = {
      method: 'get',
      muteHttpExceptions: true
    };
    
    var response = UrlFetchApp.fetch(url, options);
    var data = JSON.parse(response.getContentText());
    
    if (data) {
      var city = data.city || data.locality || '';
      var province = data.principalSubdivision || '';
      
      var result = '';
      if (province) result += province;
      if (city && city !== province) result += city;
      
      return result || '附近';
    }
    
    return '';
  } catch (error) {
    Logger.log('Geocoding error: ' + error);
    return '';
  }
}

function testConfig() {
  // 直接使用全域變數
  Logger.log('API_BASE: ' + BASE_URL);
  Logger.log('應該是: https://tdx.transportdata.tw/api/advanced/v1');
}

function testFull() {
  Logger.log('========== 開始測試 ==========');
  
  // 直接使用全域變數
  Logger.log('API Base: ' + BASE_URL);
  
  var lat = 25.047924;
  var lon = 121.517081;
  
  var onStreet = queryOnStreet(lat, lon);
  var parking = queryParking(lat, lon);
  
  Logger.log('\n路邊停車格:\n' + onStreet);
  Logger.log('\n停車場:\n' + parking);
  
  Logger.log('========== 測試完成 ==========');
}
