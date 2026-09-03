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
// TDX 基礎會員每把金鑰 5 次/分；依本分鐘用量挑金鑰，撞上限自動換下一把
var TDX_KEYS = parseTDXKeys(PROPS.getProperty('TDX_KEYS'))
var TDX_RATE_LIMIT = 5

// 屬性是人工填的，JSON 打錯不能讓頂層丟例外——那會發生在 doPost 的 try 之前，
// web app 直接回 500，執行記錄裡看不出跟 LINE 或 TDX 無關
function parseTDXKeys(raw) {
  try {
    var keys = JSON.parse(raw || '[]')
    if (!Array.isArray(keys)) return []
    // 缺 id 或 secret 的項目（例如佔位的 null）在這裡就濾掉，後面每個用到 TDX_KEYS[i].id 的地方才不用各自防
    var valid = keys.filter(function (k) { return k && typeof k.id === 'string' && typeof k.secret === 'string' })
    if (valid.length !== keys.length) Logger.log('TDX_KEYS 有 ' + (keys.length - valid.length) + ' 筆缺 id 或 secret，已忽略')
    return valid
  } catch (err) {
    Logger.log('TDX_KEYS 格式錯誤，請檢查指令碼屬性: ' + err)
    return []
  }
}
var AUTH_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token'
var BASE_URL = 'https://tdx.transportdata.tw/api/advanced/v1'
var BASE_URL_BASIC = 'https://tdx.transportdata.tw/api/basic/v1'
var LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'
// 新北市政府沒把路外停車場上傳 TDX（TDX 的 NewTaipei CarPark 是空的，只有台鐵等業者自行上傳的場站），
// 改接新北開放資料：靜態清單 6h 快取、即時剩餘車位 3 分鐘快取，用停車場 ID 對上
var NTPC_API = 'https://data.ntpc.gov.tw/api/datasets/'
var NTPC_CARPARK_STATIC = 'b1464ef0-9c7c-4a6f-abf7-6bdf32847e68'
var NTPC_CARPARK_LIVE = 'e09b35a5-a738-48cc-b0f5-570b67ad9c78'
var NTPC_PAGE_SIZE = 1000
// 基隆市政府同樣沒上傳 TDX。靜態 CSV 只有 22 座公有場站、沒有座標（地址用 Google geocode 一次，永久存在
// ScriptProperties）；即時剩餘只有 HTML 表格，用名稱比對接上
var KLCG_STATIC_CSV = 'https://www.klcg.gov.tw/wSite/public/Attachment/01602/f1728958369371.csv'
var KLCG_LIVE_PAGE = 'https://e-traffic.klcg.gov.tw/KeelungTraffic/pages/park.jsp'
// 基隆即時頁有些場站的時間戳停在幾個月前，超過一天視為失聯；新北的即時 API 沒有時間戳，整份每 3 分鐘更新
var KLCG_LIVE_STALE_MS = 24 * 60 * 60 * 1000
var SEARCH_RADIUS_KM = 1.0
var MAX_EVENTS = 10
// 直線最近的前幾筆再問 Google 開車時間（一般帳號 directions 每日 1,000 次）
var DRIVE_TIME_SEGMENTS = 3
var DRIVE_TIME_CARPARKS = 2
// 同一起點格（約 100m）到同一終點的開車時間快取 30 分鐘：原地重查、同區的人接連查都不再問 Google
var DRIVE_TIME_CACHE_SECONDS = 1800
// 一次 doPost 執行的 directions 總預算：端點不驗來源，一個 POST 塞 10 個位置事件不能變成 80 次呼叫
var DRIVE_TIME_BUDGET = DRIVE_TIME_SEGMENTS + DRIVE_TIME_CARPARKS
var driveTimeCallsLeft = DRIVE_TIME_BUDGET

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
      if (event.type !== 'message' || !event.message || event.message.type !== 'location') continue;
      // 一個事件失敗（回覆逾時、payload 異常）不能把同批其他使用者的事件一起帶掉
      try {
        handleLocation(event);
      } catch (err) {
        Logger.log('事件 ' + i + ' 處理失敗: ' + err);
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
  replyLine(replyToken, buildReply(lat, lon));
}

// 兩個 TDX NearBy 同時發出，之後的路段表、新北資料多半命中快取
function buildReply(lat, lon) {
  var city = resolveTDXCity(lat, lon);
  var radiusM = Math.round(SEARCH_RADIUS_KM * 1000);
  var nearby = encodeURIComponent('nearby(' + lat + ',' + lon + ',' + radiusM + ')');
  // 新北／基隆的即時剩餘快取失效時，把那幾筆請求併進同一批，不要等 TDX 回來才開始抓
  var liveRequests = liveCacheRequests(city);
  var responses = tdxFetchAll([
    BASE_URL + '/Parking/OnStreet/ParkingSpot/NearBy?$spatialFilter=' + nearby + '&$format=JSON&$top=10',
    BASE_URL + '/Parking/OffStreet/CarPark/NearBy?$spatialFilter=' + nearby + '&$format=JSON&$top=5'
  ], liveRequests);
  primeLiveCache(city, responses.slice(2));
  var onStreet = queryOnStreet(lat, lon, city, responses[0]);
  var parking = queryParking(lat, lon, city, responses[1]);
  
  return '📍 停車資訊查詢結果\n\n' +
            '🚗 路邊停車格 (' + radiusM + 'm內)\n' + onStreet +
            '\n━━━━━━━━━━━━━━━━\n\n' +
            '🏢 停車場 (' + radiusM + 'm內)\n' + parking;
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
  var cache = CacheService.getScriptCache();
  var cacheKey = 'tdx_token_' + key.id;
  var cached = cache.get(cacheKey);
  if (cached) return cached;

  var response = UrlFetchApp.fetch(AUTH_URL, {
    method: 'post',
    payload: { grant_type: 'client_credentials', client_id: key.id, client_secret: key.secret },
    muteHttpExceptions: true
  });
  // auth 端點掛掉時回的是 HTML 不是 JSON；這裡回 null 讓 tdxFetch 換下一把，而不是整段查詢中斷
  var data;
  try {
    data = JSON.parse(response.getContentText());
  } catch (err) {
    Logger.log('TDX auth 回應非 JSON（狀態 ' + response.getResponseCode() + '）');
    return null;
  }
  if (data.access_token) cache.put(cacheKey, data.access_token, 21600);
  return data.access_token || null;
}

// 每把金鑰本分鐘的用量放在 CacheService（key: tdx_rate_<id>_<minute>，60 秒過期）
function tdxRateKey(keyIndex) {
  return 'tdx_rate_' + TDX_KEYS[keyIndex].id + '_' + Math.floor(Date.now() / 60000);
}

// 把金鑰標記為本分鐘用滿：429、401/403、拿不到 token 都不該在這一分鐘內再試
function markTDXKeyExhausted(keyIndex) {
  CacheService.getScriptCache().put(tdxRateKey(keyIndex), String(TDX_RATE_LIMIT), 60);
}

// 挑本分鐘用量最少且未滿的金鑰並記一次用量；全部用滿回傳 -1
function pickTDXKey() {
  var cache = CacheService.getScriptCache();
  var rateKeys = TDX_KEYS.map(function (_, i) { return tdxRateKey(i); });
  var counts = cache.getAll(rateKeys);
  var best = -1;
  var bestCount = TDX_RATE_LIMIT;
  for (var i = 0; i < rateKeys.length; i++) {
    var count = Number(counts[rateKeys[i]] || 0);
    if (count < bestCount) {
      best = i;
      bestCount = count;
    }
  }
  if (best >= 0) cache.put(rateKeys[best], String(bestCount + 1), 60);
  return best;
}

// 帶金鑰輪替的 TDX GET：用量計數挑金鑰，這把不能用就標記用滿換下一把；全部用滿回傳 429 的空 response
function tdxFetch(url) {
  if (!TDX_KEYS.length) throw new Error('TDX_KEYS 未設定或格式錯誤');

  for (var n = 0; n < TDX_KEYS.length; n++) {
    var keyIndex = pickTDXKey();
    if (keyIndex < 0) break;
    var token = getTDXToken(keyIndex);
    if (!token) {
      Logger.log('金鑰 ' + keyIndex + ' 取不到 token，換下一把');
      markTDXKeyExhausted(keyIndex);
      continue;
    }
    // muteHttpExceptions 只管 HTTP 狀態碼；連線層例外（DNS、配額）仍會丟，一樣換下一把
    var response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'authorization': 'Bearer ' + token },
        muteHttpExceptions: true
      });
    } catch (err) {
      Logger.log('金鑰 ' + keyIndex + ' 連線失敗: ' + err + '，換下一把');
      markTDXKeyExhausted(keyIndex);
      continue;
    }
    // 429 是頻率上限，401/403 是金鑰失效，兩者都該換下一把而不是把錯誤丟回呼叫端
    var code = response.getResponseCode();
    if (code !== 429 && code !== 401 && code !== 403) return response;
    Logger.log('金鑰 ' + keyIndex + ' 回應 ' + code + '，換下一把');
    markTDXKeyExhausted(keyIndex);
  }
  Logger.log('所有 TDX 金鑰本分鐘已用滿');
  return { getResponseCode: function () { return 429; }, getContentText: function () { return ''; } };
}

// 同時發出多個請求；整批丟例外時退回逐一發送，單一請求失敗回 null
function fetchAllSafe(requests) {
  try {
    return UrlFetchApp.fetchAll(requests);
  } catch (err) {
    Logger.log('fetchAll 失敗，改逐一發送: ' + err);
  }
  return requests.map(function (req) {
    try {
      return UrlFetchApp.fetch(req.url, req);
    } catch (err) {
      Logger.log('請求失敗 ' + req.url.slice(0, 80) + ': ' + err);
      return null;
    }
  });
}

// 多個 TDX GET 併發：各挑一把金鑰同時發出；哪一筆撞到金鑰問題就標記用滿，退回 tdxFetch 換把重試。
// extraRequests 是不需要 TDX 金鑰的其他請求，搭同一批發出，回傳陣列接在 TDX 結果後面（失敗為 null）
function tdxFetchAll(urls, extraRequests) {
  if (!TDX_KEYS.length) throw new Error('TDX_KEYS 未設定或格式錯誤');
  extraRequests = extraRequests || [];
  var keyIndexes = urls.map(function () { return pickTDXKey(); });
  // 沒有可用金鑰或拿不到 token 的那幾筆不進批次，直接交給 tdxFetch 處理（它會回 429 空 response）
  var slots = [];
  var requests = [];
  urls.forEach(function (url, i) {
    var token = keyIndexes[i] >= 0 ? getTDXToken(keyIndexes[i]) : null;
    if (!token) return;
    slots.push(i);
    requests.push({ url: url, method: 'get', headers: { 'authorization': 'Bearer ' + token }, muteHttpExceptions: true });
  });
  var batch = requests.length + extraRequests.length ? fetchAllSafe(requests.concat(extraRequests)) : [];
  var responses = [];
  slots.forEach(function (i, n) { responses[i] = batch[n]; });
  var tdxResponses = urls.map(function (url, i) {
    var code = responses[i] ? responses[i].getResponseCode() : 0;
    if (code && code !== 429 && code !== 401 && code !== 403) return responses[i];
    if (keyIndexes[i] >= 0) markTDXKeyExhausted(keyIndexes[i]);
    return tdxFetch(url);
  });
  return tdxResponses.concat(batch.slice(requests.length));
}

// 用 Google 反查座標所在縣市，回傳 TDX City 代碼；查不到回傳 null
// 座標取到小數 2 位當快取鍵（約 1km 格）省 geocode 配額；縣市交界的格子可能判到鄰縣市，
// 影響只是那格的路段名對不到而退回顯示路段 ID
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

// CacheService 單筆上限 100KB（位元組）；每塊 30000 個字元最多 90KB，切塊存，索引鍵記塊數
var CACHE_CHUNK_CHARS = 30000;

function cachePutChunked(cache, key, text, ttlSeconds) {
  var parts = {};
  var count = Math.ceil(text.length / CACHE_CHUNK_CHARS);
  for (var i = 0; i < count; i++) {
    parts[key + '_' + i] = text.substr(i * CACHE_CHUNK_CHARS, CACHE_CHUNK_CHARS);
  }
  parts[key] = String(count);
  cache.putAll(parts, ttlSeconds);
}

// 任一塊過期就當整份沒有，回 null 讓呼叫端重抓
function cacheGetChunked(cache, key) {
  var count = Number(cache.get(key));
  if (!count) return null;
  var keys = [];
  for (var i = 0; i < count; i++) keys.push(key + '_' + i);
  var parts = cache.getAll(keys);
  var text = '';
  for (var j = 0; j < count; j++) {
    if (parts[keys[j]] == null) return null;
    text += parts[keys[j]];
  }
  return text;
}

// 取得整個縣市的路段資料 { ID: [路名, 起迄路口, 收費說明] }，快取 6h（TDX 基礎會員 5 次/分，不能每次查詢都打）
// 起迄路口與收費目前只有台北市有填，其他縣市為空字串
function getSegmentInfo(city) {
  if (!city) return {};
  var cache = CacheService.getScriptCache();
  var cacheKey = 'seginfo_' + city;
  var cached = cacheGetChunked(cache, cacheKey);
  if (cached) return JSON.parse(cached);

  var info = {};
  try {
    var url = BASE_URL_BASIC + '/Parking/OnStreet/ParkingSegment/City/' + city +
              '?$select=ParkingSegmentID,ParkingSegmentName,RoadSection,FareDescription&$format=JSON';
    var response = tdxFetch(url);
    if (response.getResponseCode() !== 200) {
      Logger.log('路段資料狀態: ' + response.getResponseCode());
      return info;
    }
    // basic/v1 回裸陣列，v2 包成 { ParkingSegments: [...] }，兩種都接
    var body = JSON.parse(response.getContentText());
    var segments = Array.isArray(body) ? body : (body.ParkingSegments || []);
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var zh = (seg.ParkingSegmentName || {}).Zh_tw;
      if (!zh) continue;
      var road = seg.RoadSection || {};
      var start = tdxText(road.Start);
      var end = tdxText(road.End);
      var section = start && end ? start + '到' + end : '';
      info[seg.ParkingSegmentID] = [zh, section, tdxText(seg.FareDescription)];
    }
    if (!segments.length) {
      Logger.log('路段資料：' + city + ' 回應解不出路段，不寫快取');
      return info;
    }
    cachePutChunked(cache, cacheKey, JSON.stringify(info), 21600);
  } catch (err) {
    Logger.log('路段資料錯誤: ' + err);
  }
  return info;
}

// TDX 沒填的文字欄位有時是 null、有時是「-」佔位符，一律回空字串
function tdxText(value) {
  return value && value !== '-' ? value : '';
}

function segmentTitle(info, segId) {
  var seg = info[segId];
  if (!seg) return '路段 ' + segId;
  return seg[1] ? seg[0] + '（' + seg[1] + '）' : seg[0];
}

// ========== 新北開放資料 ==========

// TWD97 TM2（中央經線 121、k0 0.9999、東偏 250000，GRS80）→ WGS84 經緯度
function twd97ToWgs84(x, y) {
  var a = 6378137.0, b = 6356752.314245, k0 = 0.9999, lon0 = 121 * Math.PI / 180;
  var e = Math.sqrt(1 - (b * b) / (a * a));
  var e2 = (e * a / b) * (e * a / b);
  x -= 250000;
  var mu = (y / k0) / (a * (1 - e * e / 4 - 3 * Math.pow(e, 4) / 64 - 5 * Math.pow(e, 6) / 256));
  var e1 = (1 - Math.sqrt(1 - e * e)) / (1 + Math.sqrt(1 - e * e));
  var fp = mu + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) +
           (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) +
           (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) +
           (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
  var sinFp = Math.sin(fp), cosFp = Math.cos(fp), tanFp = Math.tan(fp);
  var C1 = e2 * cosFp * cosFp;
  var T1 = tanFp * tanFp;
  var N1 = a / Math.sqrt(1 - e * e * sinFp * sinFp);
  var R1 = a * (1 - e * e) / Math.pow(1 - e * e * sinFp * sinFp, 1.5);
  var D = x / (N1 * k0);
  var lat = fp - (N1 * tanFp / R1) * (D * D / 2 -
            (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * e2) * Math.pow(D, 4) / 24 +
            (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 3 * C1 * C1 - 252 * e2) * Math.pow(D, 6) / 720);
  var lon = lon0 + (D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 +
            (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * e2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / cosFp;
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// 新北開放資料每頁最多 1000 筆：前三頁併發抓，最後一頁仍滿頁就再逐頁補。
// 任一頁失敗回 null，不能讓半份清單被當成完整資料快取 6 小時
function ntpcPageUrl(dataset, page) {
  return NTPC_API + dataset + '/json?page=' + page + '&size=' + NTPC_PAGE_SIZE;
}

function ntpcFirstPageRequests(dataset) {
  return [0, 1, 2].map(function (p) { return { url: ntpcPageUrl(dataset, p), muteHttpExceptions: true }; });
}

function ntpcFetchAllPages(dataset) {
  return ntpcRowsFromPages(dataset, fetchAllSafe(ntpcFirstPageRequests(dataset)));
}

// responses 是前三頁的回應（可能含 null）；不足一頁就停，仍滿頁就逐頁補
function ntpcRowsFromPages(dataset, responses) {
  var pageUrl = function (page) { return ntpcPageUrl(dataset, page); };
  var rows = [];
  var lastCount = 0;
  for (var i = 0; i < responses.length; i++) {
    if (!responses[i] || responses[i].getResponseCode() !== 200) return null;
    var page = JSON.parse(responses[i].getContentText());
    lastCount = page.length;
    rows = rows.concat(page);
    if (lastCount < NTPC_PAGE_SIZE) return rows;
  }
  for (var p = 3; lastCount === NTPC_PAGE_SIZE && p < 20; p++) {
    var res = UrlFetchApp.fetch(pageUrl(p), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var more = JSON.parse(res.getContentText());
    lastCount = more.length;
    rows = rows.concat(more);
  }
  return rows;
}

// 新北路外停車場靜態清單 → [[ID, 名稱, 地址, lat, lon, 收費, 汽車格數], ...]，快取 6h、切塊存
function getNtpcCarparks() {
  var cache = CacheService.getScriptCache();
  var cached = cacheGetChunked(cache, 'ntpc_carparks');
  if (cached) return JSON.parse(cached);
  var list = [];
  try {
    var rows = ntpcFetchAllPages(NTPC_CARPARK_STATIC);
    if (!rows) return list;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var x = Number(r.TW97X), y = Number(r.TW97Y);
      if (!x || !y) continue;
      var total = Number(r.TOTALCAR) || 0;
      if (!total) continue;  // 只有機車或自行車位的場站，對開車的人沒用
      var geo = twd97ToWgs84(x, y);
      var fare = (r.PAYEX || '').split(';')[0];
      list.push([r.ID, r.NAME, r.ADDRESS || '', Number(geo.lat.toFixed(5)), Number(geo.lon.toFixed(5)), fare, total]);
    }
    if (list.length) cachePutChunked(cache, 'ntpc_carparks', JSON.stringify(list), 21600);
  } catch (err) {
    Logger.log('新北停車場清單錯誤: ' + err);
  }
  return list;
}

// 新北即時剩餘汽車位 { ID: 剩餘數 }，來源每 3 分鐘更新，快取 180s
function getNtpcLive() {
  var cached = cacheGetChunked(CacheService.getScriptCache(), 'ntpc_live');
  if (cached) return JSON.parse(cached);
  try {
    return cacheNtpcLive(ntpcFetchAllPages(NTPC_CARPARK_LIVE));
  } catch (err) {
    Logger.log('新北即時車位錯誤: ' + err);
    return {};
  }
}

// rows 為 null（抓取失敗）時回空表且不寫快取
function cacheNtpcLive(rows) {
  var live = {};
  if (!rows) return live;
  for (var i = 0; i < rows.length; i++) {
    var n = Number(rows[i].AVAILABLECAR);
    if (rows[i].ID && n >= 0) live[rows[i].ID] = n;
  }
  if (rows.length) cachePutChunked(CacheService.getScriptCache(), 'ntpc_live', JSON.stringify(live), 180);
  return live;
}

// 兩筆座標距離小於 km 視為同一座，保留先出現的
function dedupeNearby(entries, km) {
  var kept = [];
  entries.forEach(function (e) {
    var dup = kept.some(function (k) { return calculateDistance(e.lat, e.lon, k.lat, k.lon) < km; });
    if (!dup) kept.push(e);
  });
  return kept;
}

// 新北停車場中距離 radiusKm 內的，整理成與 TDX 停車場相同的 entry 形狀
function ntpcCarparksNear(lat, lon, radiusKm) {
  var live = null;
  var entries = [];
  var list = getNtpcCarparks();
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (calculateDistance(lat, lon, c[3], c[4]) > radiusKm) continue;
    if (live === null) live = getNtpcLive();
    entries.push({ name: c[1], address: c[2], lat: c[3], lon: c[4], fare: c[5], total: c[6], available: live[c[0]] });
  }
  return entries;
}

// ========== 基隆開放資料 ==========

// 地址 → 經緯度。查到的永久存在 ScriptProperties（geocode 配額每日 1,000，一個地址只該花一次）；
// 查無結果只在 CacheService 記 6h 後重試（地址寫法或 Google 的解析會變）；暫時性錯誤回 false，不記錄
function geocodeCached(address) {
  var props = PropertiesService.getScriptProperties();
  var key = 'geo_' + address;
  var cached = props.getProperty(key);
  if (cached) return { lat: Number(cached.split(',')[0]), lon: Number(cached.split(',')[1]) };
  var cache = CacheService.getScriptCache();
  if (cache.get(key)) return null;
  try {
    var geo = Maps.newGeocoder().setLanguage('zh-TW').setRegion('tw').geocode(address);
    var loc = geo.results && geo.results[0] && geo.results[0].geometry && geo.results[0].geometry.location;
    if (!loc) {
      Logger.log('地址反查無結果（' + geo.status + '），6 小時後重試: ' + address);
      cache.put(key, 'none', 21600);
      return null;
    }
    props.setProperty(key, loc.lat + ',' + loc.lng);
    return { lat: loc.lat, lon: loc.lng };
  } catch (err) {
    Logger.log('地址反查失敗 ' + address + ': ' + err);
    return false;
  }
}

// 兩邊名稱寫法差很多（「基隆市信二立體停車場」vs「力揚基隆信二立體」），去掉這些修飾詞後用包含關係比對
function klcgNormalizeName(name) {
  return name.replace(/基隆市|基隆|力揚|停車場|立體|平面|地下室|地下|臨時|[()（）\s]/g, '');
}

// 基隆公有路外停車場 → [[名稱, 地址, lat, lon, 小型車格數], ...]，快取 6h
function getKlcgCarparks() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('klcg_carparks');
  if (cached) return JSON.parse(cached);
  var list = [];
  try {
    var response = UrlFetchApp.fetch(KLCG_STATIC_CSV, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return list;
    var rows = Utilities.parseCsv(response.getContentText('Big5'));
    var complete = true;
    for (var i = 1; i < rows.length; i++) {
      var total = Number((/小型車(\d+)位/.exec(rows[i][1] || '') || [])[1]) || 0;
      if (!total) continue;
      var address = (rows[i][2] || '').trim();
      var point = geocodeCached(/基隆/.test(address) ? address : '基隆市' + address);
      if (point === false) complete = false;  // 暫時性錯誤：這次先少一座，但不把缺漏的清單快取 6h
      if (!point) continue;
      list.push([rows[i][0].trim(), address, Number(point.lat.toFixed(5)), Number(point.lon.toFixed(5)), total]);
    }
    if (list.length && complete) cache.put('klcg_carparks', JSON.stringify(list), 21600);
  } catch (err) {
    Logger.log('基隆停車場清單錯誤: ' + err);
  }
  return list;
}

// 基隆即時剩餘 { 正規化名稱: 剩餘數 }，快取 180s；更新時間超過一天的視為失聯不採用
function getKlcgLive() {
  var cached = CacheService.getScriptCache().get('klcg_live');
  if (cached) return JSON.parse(cached);
  try {
    var response = UrlFetchApp.fetch(KLCG_LIVE_PAGE, { muteHttpExceptions: true });
    return cacheKlcgLive(response.getResponseCode() === 200 ? response.getContentText() : null);
  } catch (err) {
    Logger.log('基隆即時車位錯誤: ' + err);
    return {};
  }
}

// html 為 null（抓取失敗）時回空表且不寫快取
function cacheKlcgLive(html) {
  var live = {};
  if (!html) return live;
  var row = /<td>([^<]+)<\/td>\s*<td>(\d+)<\/td>\s*<td>([^<]+)<\/td>/g;
  var m;
  while ((m = row.exec(html)) !== null) {
    var updated = new Date(m[3].trim().replace(' ', 'T') + ':00+08:00').getTime();
    if (isNaN(updated) || Date.now() - updated > KLCG_LIVE_STALE_MS) continue;
    live[klcgNormalizeName(m[1])] = Number(m[2]);
  }
  if (Object.keys(live).length) CacheService.getScriptCache().put('klcg_live', JSON.stringify(live), 180);
  return live;
}

// 即時名稱是否指向這座靜態場站：直接包含，或是併記名稱的一段（「光明停二」對「光明停一停二」：
// 共用前綴「光明停」至少 2 個字，剩下的「二」出現在前綴之後）
function klcgKeyMatches(target, key) {
  if (target.indexOf(key) >= 0) return true;
  var p = 0;
  while (p < target.length && p < key.length && target[p] === key[p]) p++;
  return p >= 2 && key.length > p && target.indexOf(key.slice(p), p) >= 0;
}

// 把每筆即時名稱指派給唯一一座靜態場站，回傳 { 靜態名稱: 剩餘數 }。
// 多座都對得上時（「源遠」對「源遠」和「源遠249巷第二」）給正規化名稱長度最接近的那座；
// 一座對到多筆時是併記的場站（「光明停一停二」對「光明停一」「光明停二」），相加。
// 第二輪才處理「即時名稱包含靜態名稱」的情況，且只補給還沒有數字的場站
function klcgAssignLive(live, names) {
  var targets = names.map(klcgNormalizeName);
  var assigned = {};
  var leftovers = [];
  Object.keys(live).forEach(function (key) {
    if (!key) return;
    var best = -1;
    var bestDiff = Infinity;
    targets.forEach(function (target, i) {
      var diff = Math.abs(target.length - key.length);
      if (klcgKeyMatches(target, key) && diff < bestDiff) { best = i; bestDiff = diff; }
    });
    if (best >= 0) assigned[names[best]] = (assigned[names[best]] || 0) + live[key];
    else leftovers.push(key);
  });
  leftovers.sort(function (a, b) { return a.length - b.length; }).forEach(function (key) {
    targets.forEach(function (target, i) {
      if (assigned[names[i]] === undefined && target && key.indexOf(target) >= 0) assigned[names[i]] = live[key];
    });
  });
  return assigned;
}

function klcgCarparksNear(lat, lon, radiusKm) {
  var list = getKlcgCarparks();
  var near = list.filter(function (c) { return calculateDistance(lat, lon, c[2], c[3]) <= radiusKm; });
  if (!near.length) return [];
  // 指派要看全部 22 座，不能只看範圍內的，否則範圍外的正主不在場時即時數會被鄰近同名場站認走
  var available = klcgAssignLive(getKlcgLive(), list.map(function (c) { return c[0]; }));
  return near.map(function (c) {
    return { name: c[0], address: c[1], lat: c[2], lon: c[3], total: c[4], available: available[c[0]] };
  });
}

// 該縣市即時剩餘的快取若已失效，回傳要抓的請求，讓 buildReply 併進 TDX 那一批；快取還在就回空陣列
function liveCacheRequests(city) {
  var cache = CacheService.getScriptCache();
  switch (city) {
    case 'NewTaipei': return cache.get('ntpc_live') ? [] : ntpcFirstPageRequests(NTPC_CARPARK_LIVE);
    case 'Keelung': return cache.get('klcg_live') ? [] : [{ url: KLCG_LIVE_PAGE, muteHttpExceptions: true }];
    default: return [];
  }
}

// 把 liveCacheRequests 那幾筆的回應寫進快取；responses 為空表示快取原本就在
function primeLiveCache(city, responses) {
  if (!responses.length) return;
  try {
    switch (city) {
      case 'NewTaipei': cacheNtpcLive(ntpcRowsFromPages(NTPC_CARPARK_LIVE, responses)); break;
      case 'Keelung': cacheKlcgLive(responses[0] && responses[0].getResponseCode() === 200 ? responses[0].getContentText() : null); break;
    }
  } catch (err) {
    Logger.log('即時車位預載錯誤: ' + err);
  }
}

// 市府沒上傳 TDX 的縣市，補上該市自己的開放資料
function extraCarparksNear(city, lat, lon, radiusKm) {
  switch (city) {
    case 'NewTaipei': return ntpcCarparksNear(lat, lon, radiusKm);
    case 'Keelung': return klcgCarparksNear(lat, lon, radiusKm);
    default: return [];
  }
}

// ========== 距離與導航 ==========

// Google 開車時間；本次執行預算用完、配額用完或查不到路線回 null，呼叫端退回直線距離
function driveTime(fromLat, fromLon, toLat, toLon) {
  if (driveTimeCallsLeft <= 0) return null;
  driveTimeCallsLeft--;
  try {
    var directions = Maps.newDirectionFinder()
      .setOrigin(fromLat, fromLon)
      .setDestination(toLat, toLon)
      .setMode(Maps.DirectionFinder.Mode.DRIVING)
      .getDirections();
    var route = directions.routes && directions.routes[0];
    var leg = route && route.legs && route.legs[0];
    if (!leg) return null;
    return { seconds: leg.duration.value, meters: leg.distance.value };
  } catch (err) {
    Logger.log('開車時間查詢失敗: ' + err);
    return null;
  }
}

// entries 需有數字 lat/lon（缺座標的先剔除）。先依直線距離排序，前 driveCount 筆再問開車時間並依時間重排，
// 其餘維持直線距離順序
function rankByTravel(lat, lon, entries, driveCount) {
  entries = entries.filter(function (e) { return typeof e.lat === 'number' && typeof e.lon === 'number'; });
  for (var i = 0; i < entries.length; i++) {
    entries[i].km = calculateDistance(lat, lon, entries[i].lat, entries[i].lon);
  }
  entries.sort(function (a, b) { return a.km - b.km; });
  var count = Math.min(driveCount, entries.length);
  var cache = CacheService.getScriptCache();
  var keys = entries.slice(0, count).map(function (e) {
    return 'drive_' + lat.toFixed(3) + '_' + lon.toFixed(3) + '_' + e.lat.toFixed(5) + '_' + e.lon.toFixed(5);
  });
  var cached = cache.getAll(keys);
  for (var j = 0; j < count; j++) {
    if (cached[keys[j]]) {
      entries[j].drive = JSON.parse(cached[keys[j]]);
      continue;
    }
    entries[j].drive = driveTime(lat, lon, entries[j].lat, entries[j].lon);
    if (entries[j].drive) cache.put(keys[j], JSON.stringify(entries[j].drive), DRIVE_TIME_CACHE_SECONDS);
  }
  var head = entries.slice(0, count).sort(function (a, b) {
    var sa = a.drive ? a.drive.seconds : Infinity;
    var sb = b.drive ? b.drive.seconds : Infinity;
    return sa - sb || a.km - b.km;
  });
  return head.concat(entries.slice(count));
}

function travelLine(entry) {
  if (entry.drive) {
    return '🚗 約 ' + Math.max(1, Math.round(entry.drive.seconds / 60)) + ' 分鐘（' +
           (entry.drive.meters / 1000).toFixed(1) + 'km）';
  }
  return '📍 ' + entry.km.toFixed(2) + 'km';
}

// 點開直接進 Google Maps 開車導航，起點用手機目前位置
function navLink(lat, lon) {
  return '🧭 https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon + '&travelmode=driving';
}

function queryOnStreet(lat, lon, city, response) {
  try {
    var status = response.getResponseCode();
    
    Logger.log('路邊停車格狀態: ' + status);
    
    if (status === 404) {
      return '目前沒有查詢到路邊停車格';
    }
    if (status === 429) {
      return '⏳ 查詢人數太多，請一分鐘後再試';
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
    
    // 依距離／開車時間排序後顯示各路段
    var entries = Object.keys(segments).map(function (segId) {
      var seg = segments[segId];
      var pos = seg.position || {};
      return { segId: segId, spotCount: seg.spots.length, lat: pos.PositionLat, lon: pos.PositionLon };
    });
    var ranked = rankByTravel(lat, lon, entries, DRIVE_TIME_SEGMENTS);
    var info = getSegmentInfo(city);
    var displayCount = Math.min(ranked.length, 10);
    var result = '';
    
    for (var i = 0; i < displayCount; i++) {
      var entry = ranked[i];
      var fare = (info[entry.segId] || [])[2];
      result += '【' + (i + 1) + '】' + segmentTitle(info, entry.segId) + '\n';
      result += '🅿️ 共 ' + entry.spotCount + ' 格（小客車）\n';
      if (fare) result += '💰 ' + fare + '\n';
      result += travelLine(entry) + '\n';
      result += navLink(entry.lat, entry.lon) + '\n\n';
    }
    
    if (ranked.length > 10) {
      result += '... 還有 ' + (ranked.length - 10) + ' 個路段\n';
    }
    
    return result || '目前沒有查詢到路邊停車格';
    
  } catch (err) {
    Logger.log('路邊停車格錯誤: ' + err);
    return '❌ 查詢失敗';
  }
}

function queryParking(lat, lon, city, response) {
  try {
    var status = response.getResponseCode();
    Logger.log('停車場狀態: ' + status);
    
    // TDX 404 代表範圍內沒有，不是錯誤；新北另有自己的來源，所以先把 TDX 的結果收成 entries 再一起判斷
    var entries = [];
    if (status === 200) {
      var items = JSON.parse(response.getContentText());
      entries = (Array.isArray(items) ? items : []).slice(0, 5).map(function (item) {
        var pos = item.CarParkPosition || {};
        return {
          name: (item.CarParkName && item.CarParkName.Zh_tw) || '未知',
          address: item.Address || '無地址',
          lat: pos.PositionLat,
          lon: pos.PositionLon
        };
      });
    } else if (status !== 404 && status !== 429) {
      return '❌ 查詢錯誤 (狀態: ' + status + ')';
    }
    // 台鐵等業者自行上傳 TDX 的場站，市府清單裡多半也有；50m 內視為同一座，保留先到的 TDX 那筆
    entries = dedupeNearby(entries.concat(extraCarparksNear(city, lat, lon, SEARCH_RADIUS_KM)), 0.05);
    
    if (!entries.length) {
      return status === 429 ? '⏳ 查詢人數太多，請一分鐘後再試' : '目前沒有查詢到停車場';
    }
    
    var ranked = rankByTravel(lat, lon, entries, DRIVE_TIME_CARPARKS).slice(0, 5);
    var result = '';
    for (var i = 0; i < ranked.length; i++) {
      var entry = ranked[i];
      result += '【' + (i + 1) + '】' + entry.name + '\n';
      result += '📮 ' + entry.address + '\n';
      if (entry.total !== undefined) {
        result += '🅿️ ' + (entry.available !== undefined ? '剩餘 ' + entry.available + ' / ' : '共 ') + entry.total + ' 格\n';
      }
      if (entry.fare) result += '💰 ' + entry.fare + '\n';
      result += travelLine(entry) + '\n';
      result += navLink(entry.lat, entry.lon) + '\n\n';
    }
    return result;
    
  } catch (err) {
    Logger.log('停車場錯誤: ' + err);
    return '❌ 查詢失敗';
  }
}

// ========== 排程 ==========

// 掛在時間觸發器上（建議每 4 小時），讓路段表、新北與基隆清單、22 次地址反查都不落在使用者的查詢上
function warmCaches() {
  getSegmentInfo('Taipei');
  getSegmentInfo('NewTaipei');
  getNtpcCarparks();
  Logger.log('基隆場站 ' + getKlcgCarparks().length + ' 座已預熱');
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
  if (!TDX_KEYS.length) problems.push('TDX_KEYS 未設定、格式錯誤，或沒有一筆同時有 id 和 secret');
  Logger.log(problems.length
    ? '✗ 設定有問題:\n' + problems.join('\n')
    : '✓ 設定完整，TDX 金鑰 ' + TDX_KEYS.length + ' 把');
}

function testFull() {
  Logger.log('========== 開始測試 ==========');
  
  // 直接使用全域變數
  Logger.log('API Base: ' + BASE_URL);
  
  // 三重（新北開放資料）、基隆車站（基隆開放資料）、台北車站（純 TDX）各跑一次
  Logger.log('\n三重:\n' + buildReply(25.069, 121.478));
  driveTimeCallsLeft = DRIVE_TIME_BUDGET;
  Logger.log('\n基隆車站:\n' + buildReply(25.1318, 121.7394));
  driveTimeCallsLeft = DRIVE_TIME_BUDGET;  // 預算是每次執行一份，後面每次查詢重新給滿額才看得到開車時間
  Logger.log('\n台北車站:\n' + buildReply(25.047924, 121.517081));
  
  Logger.log('========== 測試完成 ==========');
}
