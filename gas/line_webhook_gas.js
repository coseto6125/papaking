/**
 * LINE Webhook for Google Apps Script - 最終版
 * 全台停車資訊查詢
 */

// ========== 設定區 ==========
// 所有設定值放在「專案設定 > 指令碼屬性」，不進版控
// 需要的屬性：LINE_CHANNEL_ACCESS_TOKEN、
// TDX_KEYS（JSON 陣列，格式 [{"id":"...","secret":"..."}]）
// 註：GAS 的 doPost(e) 讀不到 HTTP 標頭，拿不到 X-Line-Signature，
//     所以做不了 LINE 官方的簽章驗證，Channel secret 在這裡沒有用處。

var PROPS = PropertiesService.getScriptProperties()
var LINE_CHANNEL_ACCESS_TOKEN = PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN')
// TDX 基礎會員每把金鑰 5 次/分；多把輪替，撞上限自動換下一把
var TDX_KEYS = parseTDXKeys(PROPS.getProperty('TDX_KEYS'))

// 屬性是人工填的，JSON 打錯不能讓頂層丟例外——那會發生在 doPost 的 try 之前，
// web app 直接回 500，執行記錄裡看不出跟 LINE 或 TDX 無關
function parseTDXKeys(raw) {
  try {
    var keys = JSON.parse(raw || '[]')
    return Array.isArray(keys) ? keys : []
  } catch (err) {
    Logger.log('TDX_KEYS 格式錯誤，請檢查指令碼屬性: ' + err)
    return []
  }
}
var AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token'
var BASE_URL = 'https://tdx.transportdata.tw/api/advanced/v1'
var BASE_URL_BASIC = 'https://tdx.transportdata.tw/api/basic/v1'
var LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'
var MAX_EVENTS = 10

// Google 反查回來的縣市名稱（臺 已正規化為 台）→ TDX City 代碼
var TDX_CITY = {
  '台北市': 'Taipei', '新北市': 'NewTaipei', '桃園市': 'Taoyuan', '台中市': 'Taichung',
  '台南市': 'Tainan', '高雄市': 'Kaohsiung', '基隆市': 'Keelung', '新竹市': 'Hsinchu',
  '新竹縣': 'HsinchuCounty', '苗栗縣': 'MiaoliCounty', '彰化縣': 'ChanghuaCounty',
  '南投縣': 'NantouCounty', '雲林縣': 'YunlinCounty', '嘉義縣': 'ChiayiCounty',
  '嘉義市': 'Chiayi', '屏東縣': 'PingtungCounty', '宜蘭縣': 'YilanCounty',
  '花蓮縣': 'HualienCounty', '台東縣': 'TaitungCounty', '金門縣': 'KinmenCounty',
  '澎湖縣': 'PenghuCounty', '連江縣': 'LienchiangCounty'
}



// ========== LINE Webhook ==========

function doPost(e) {
  try {
    if (!e || !e.postData) {
      return ContentService.createTextOutput('Invalid request').setMimeType(ContentService.MimeType.TEXT);
    }

    var data = JSON.parse(e.postData.contents);
    var events = data.events || [];

    // 端點無法驗證來源，事件數設上限避免單一請求把配額打光
    if (events.length > MAX_EVENTS) {
      Logger.log('事件數 ' + events.length + ' 超過上限，只處理前 ' + MAX_EVENTS + ' 筆');
      events = events.slice(0, MAX_EVENTS);
    }

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
  
  var response = UrlFetchApp.fetch(LINE_REPLY_URL, options);
  var code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('LINE 回覆失敗 ' + code + ': ' + response.getContentText());
  }
}

// ========== TDX API ==========

function getTDXToken(keyIndex) {
  // TDX token 有效 24h，每把金鑰各快取 6h，避免每次查詢都打 auth 端點
  var key = TDX_KEYS[keyIndex];
  if (!key || !key.id || !key.secret) return null;

  var cache = CacheService.getScriptCache();
  var cacheKey = 'tdx_token_' + key.id;
  var cached = cache.get(cacheKey);
  if (cached) return cached;

  var response = UrlFetchApp.fetch(AUTH_URL, {
    method: 'post',
    payload: { grant_type: 'client_credentials', client_id: key.id, client_secret: key.secret },
    muteHttpExceptions: true
  });
  var data = JSON.parse(response.getContentText());
  if (data.access_token) cache.put(cacheKey, data.access_token, 21600);
  return data.access_token;
}

// 帶金鑰輪替的 TDX GET：從隨機一把開始，這把不能用就換下一把，全部撞完回傳最後一次的 response
function tdxFetch(url) {
  if (!TDX_KEYS.length) throw new Error('TDX_KEYS 未設定或格式錯誤');

  var response = null;
  var startIndex = Math.floor(Math.random() * TDX_KEYS.length);
  for (var n = 0; n < TDX_KEYS.length; n++) {
    var keyIndex = (startIndex + n) % TDX_KEYS.length;
    var token = getTDXToken(keyIndex);
    if (!token) {
      Logger.log('金鑰 ' + keyIndex + ' 取不到 token，換下一把');
      continue;
    }
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    // 429 是頻率上限，401/403 是金鑰失效，兩者都該換下一把而不是把錯誤丟回呼叫端
    var code = response.getResponseCode();
    if (code !== 429 && code !== 401 && code !== 403) return response;
    Logger.log('金鑰 ' + keyIndex + ' 回應 ' + code + '，換下一把');
  }
  return response;
}

// 用 Google 反查座標所在縣市，回傳 TDX City 代碼；查不到回傳 null
// 座標取到小數 2 位當快取鍵（約 1km 格），同一格內縣市必定相同，省掉重複的 geocode 配額
function resolveTDXCity(lat, lon) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'city_' + lat.toFixed(2) + '_' + lon.toFixed(2);
  var cached = cache.get(cacheKey);
  if (cached) return cached === 'none' ? null : cached;

  try {
    var geo = Maps.newGeocoder().setLanguage('zh-TW').reverseGeocode(lat, lon);
    var results = geo.results || [];
    for (var i = 0; i < results.length; i++) {
      var comps = results[i].address_components || [];
      for (var j = 0; j < comps.length; j++) {
        if (comps[j].types.indexOf('administrative_area_level_1') >= 0) {
          var name = comps[j].long_name.replace(/臺/g, '台');
          var city = TDX_CITY[name] || null;
          cache.put(cacheKey, city || 'none', 21600);
          return city;
        }
      }
    }
  } catch (err) {
    Logger.log('反查縣市錯誤: ' + err);
  }
  return null;
}

// 取得整個縣市的路段 ID → 路名對照表，快取 6h（TDX 基礎會員 5 次/分，不能每次查詢都打）
function getSegmentNames(city) {
  if (!city) return {};
  var cache = CacheService.getScriptCache();
  var cacheKey = 'seg_' + city;
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var names = {};
  try {
    var url = BASE_URL_BASIC + '/Parking/OnStreet/ParkingSegment/City/' + city +
              '?$select=ParkingSegmentID,ParkingSegmentName&$format=JSON';
    var response = tdxFetch(url);
    if (response.getResponseCode() !== 200) {
      Logger.log('路段名稱狀態: ' + response.getResponseCode());
      return names;
    }
    // basic/v1 回裸陣列，v2 包成 { ParkingSegments: [...] }，兩種都接
    var body = JSON.parse(response.getContentText());
    var segments = Array.isArray(body) ? body : (body.ParkingSegments || []);
    for (var i = 0; i < segments.length; i++) {
      var zh = (segments[i].ParkingSegmentName || {}).Zh_tw;
      if (zh) names[segments[i].ParkingSegmentID] = zh;
    }
    if (!segments.length) {
      Logger.log('路段名稱：' + city + ' 回應解不出路段，不寫快取');
      return names;
    }
    // CacheService 單一值上限 100KB，超過 put 會失敗；大縣市寧可每次重打也不要靜默失效
    var payload = JSON.stringify(names);
    if (payload.length < 90000) {
      cache.put(cacheKey, payload, 21600);
    } else {
      Logger.log('路段名稱：' + city + ' 對照表 ' + payload.length + ' 位元組，超過快取上限');
    }
  } catch (err) {
    Logger.log('路段名稱錯誤: ' + err);
  }
  return names;
}

function queryOnStreet(lat, lon) {
  try {
    var url = BASE_URL + '/Parking/OnStreet/ParkingSpot/NearBy';
    var query = '?$spatialFilter=' + encodeURIComponent('nearby(' + lat + ',' + lon + ',1000)') + 
                '&$format=JSON&$top=10';
    
    Logger.log('路邊停車格 URL: ' + url + query);
    
    var response = tdxFetch(url + query);
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
    var names = getSegmentNames(resolveTDXCity(lat, lon));
    
    for (var i = 0; i < displayCount; i++) {
      var segId = segmentList[i];
      var seg = segments[segId];
      var spotCount = seg.spots.length;
      var pos = seg.position;
      
      result += '【' + (i + 1) + '】' + (names[segId] || '路段 ' + segId) + '\n';
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
    var url = BASE_URL + '/Parking/OffStreet/CarPark/NearBy';
    var query = '?$spatialFilter=' + encodeURIComponent('nearby(' + lat + ',' + lon + ',1000)') + 
                '&$format=JSON&$top=5';
    
    Logger.log('停車場 URL: ' + url + query);
    
    var response = tdxFetch(url + query);
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



function testConfig() {
  var problems = [];
  if (!LINE_CHANNEL_ACCESS_TOKEN) problems.push('LINE_CHANNEL_ACCESS_TOKEN 未設定');
  if (!TDX_KEYS.length) problems.push('TDX_KEYS 未設定或格式錯誤');
  for (var i = 0; i < TDX_KEYS.length; i++) {
    if (!TDX_KEYS[i].id || !TDX_KEYS[i].secret) problems.push('TDX_KEYS[' + i + '] 缺 id 或 secret');
  }
  Logger.log(problems.length
    ? '✗ 設定有問題:\n' + problems.join('\n')
    : '✓ 設定完整，TDX 金鑰 ' + TDX_KEYS.length + ' 把');
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
