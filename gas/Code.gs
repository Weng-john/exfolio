/**
 * Exfolio backend for Google Apps Script, storing data in Google Sheets.
 *
 * Speaks the same protocol as the local Node backend (src/core/api.ts):
 * one POST with a JSON body { action, token, ... }.
 *
 * Script properties (Project Settings → Script properties):
 *   EXFOLIO_TOKEN  required. Shared secret the frontend must send.
 *   SHEET_ID       optional. Spreadsheet to use when the script is not
 *                  bound to one.
 *
 * Nothing secret belongs in this file: it is committed to the repository.
 */

var TABLES = [
  'brokers', 'accounts', 'indices', 'instruments', 'transactions', 'loans',
  'prices', 'fxRates', 'targets', 'strategies', 'snapshots', 'settings',
  'tradeGroups', 'rotationCycles', 'priceHistory', 'rollovers', 'cashflowItems', 'scenarios'
];
var META_SHEET = '_meta';
var JSON_COLUMN = '_json';
var MAX_FAILED_ATTEMPTS = 10;
var QUOTE_TTL_SECONDS = 20;

function doGet() {
  return json_({ ok: false, error: 'Use POST' });
}

function doPost(e) {
  var response;
  try {
    var request = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var denied = authorize_(request.token);
    response = denied ? { ok: false, error: denied } : dispatch_(request);
  } catch (err) {
    response = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(response);
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Returns an error message, or '' when the token is valid. Fails closed:
 * with no EXFOLIO_TOKEN configured every request is refused.
 */
function authorize_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('EXFOLIO_TOKEN');
  if (!expected) return 'Backend is not configured: set the EXFOLIO_TOKEN script property';
  var cache = CacheService.getScriptCache();
  var failures = Number(cache.get('auth_failures') || 0);
  if (failures >= MAX_FAILED_ATTEMPTS) return 'Too many failed attempts; try again later';
  if (!safeEqual_(String(token || ''), expected)) {
    cache.put('auth_failures', String(failures + 1), 600);
    return 'Unauthorized';
  }
  return '';
}

/** Compare without stopping at the first differing character. */
function safeEqual_(a, b) {
  var diff = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) {
    diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function dispatch_(request) {
  switch (request.action) {
    case 'ping':
      return { ok: true, backend: 'gas' };
    case 'load':
      return load_();
    case 'save':
      return save_(request.tables || {}, request.baseRevision);
    case 'quotes':
      return { ok: true, quotes: fetchQuotes_(request.items || []) };
    case 'history':
      return { ok: true, history: fetchHistory_(request.items || [], request.from) };
    default:
      return { ok: false, error: 'Unknown action: ' + request.action };
  }
}

// ---- Storage ---------------------------------------------------------

function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No spreadsheet: bind the script to a sheet or set SHEET_ID');
  return ss;
}

function getRevision_(ss) {
  var sheet = ss.getSheetByName(META_SHEET);
  return sheet ? Number(sheet.getRange(1, 2).getValue()) || 0 : 0;
}

function setRevision_(ss, revision) {
  var sheet = ss.getSheetByName(META_SHEET) || ss.insertSheet(META_SHEET);
  sheet.getRange(1, 1, 1, 2).setValues([['revision', revision]]);
}

function load_() {
  var ss = spreadsheet_();
  var tables = {};
  TABLES.forEach(function (name) {
    tables[name] = readTable_(ss, name);
  });
  return { ok: true, revision: getRevision_(ss), tables: tables };
}

/**
 * Each row is stored whole as JSON in the `_json` column: that is the
 * source of truth. The other columns mirror its fields for reading in
 * Sheets and are rewritten on every save, so edits made there are lost.
 */
function readTable_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  var column = values[0].indexOf(JSON_COLUMN);
  if (column < 0) throw new Error('Sheet "' + name + '" has no ' + JSON_COLUMN + ' column');
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var cell = values[r][column];
    if (cell === '' || cell === null) continue;
    rows.push(JSON.parse(cell));
  }
  return rows;
}

function writeTable_(ss, name, rows) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var keys = [];
  rows.forEach(function (row) {
    Object.keys(row).forEach(function (key) {
      if (keys.indexOf(key) < 0) keys.push(key);
    });
  });
  var header = keys.concat([JSON_COLUMN]);
  var values = [header].concat(rows.map(function (row) {
    return keys.map(function (key) { return displayValue_(row[key]); })
      .concat([JSON.stringify(row)]);
  }));
  sheet.clearContents();
  var range = sheet.getRange(1, 1, values.length, header.length);
  // Plain text keeps Sheets from turning "0050" into 50 or "2026-01-02" into a date.
  range.setNumberFormat('@');
  range.setValues(values);
  sheet.setFrozenRows(1);
}

function displayValue_(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function save_(tables, baseRevision) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = spreadsheet_();
    var revision = getRevision_(ss);
    if (baseRevision !== undefined && baseRevision !== null && baseRevision !== revision) {
      return { ok: false, error: 'conflict', revision: revision };
    }
    TABLES.forEach(function (name) {
      var rows = tables[name];
      if (!Array.isArray(rows)) return;
      rows.forEach(function (row) {
        if (!row || typeof row !== 'object' || row.id === undefined || row.id === '') {
          throw new Error('Every row in "' + name + '" needs an id');
        }
      });
      writeTable_(ss, name, rows);
    });
    setRevision_(ss, revision + 1);
    return { ok: true, revision: revision + 1 };
  } finally {
    lock.releaseLock();
  }
}

// ---- Quotes ----------------------------------------------------------
// Free public endpoints, not licensed market data: prices may be delayed
// and the endpoints may change or rate-limit.

function quoteUrl_(item) {
  var symbol = encodeURIComponent(item.symbol);
  if (item.source === 'yahoo') {
    return 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?interval=1d&range=1d';
  }
  if (item.source === 'binance') {
    // Market-data-only host: api.binance.com refuses requests from some regions.
    return 'https://data-api.binance.vision/api/v3/ticker/price?symbol=' + symbol;
  }
  return '';
}

function parseQuote_(item, text) {
  var body = JSON.parse(text);
  if (item.source === 'yahoo') {
    var meta = body && body.chart && body.chart.result && body.chart.result[0] && body.chart.result[0].meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('No price in response');
    var seconds = meta.regularMarketTime || Date.now() / 1000;
    return {
      price: meta.regularMarketPrice,
      currency: meta.currency,
      asOf: new Date(seconds * 1000).toISOString(),
      status: 'delayed'
    };
  }
  var price = Number(body && body.price);
  if (!(price > 0)) throw new Error('No price in response');
  return { price: price, asOf: new Date().toISOString(), status: 'realtime' };
}

function fetchQuotes_(items) {
  var cache = CacheService.getScriptCache();
  var results = [];
  var pending = [];
  items.slice(0, 200).forEach(function (item, index) {
    var result = { source: item.source, symbol: item.symbol };
    results.push(result);
    var url = quoteUrl_(item);
    if (!url) {
      result.error = 'Manual source has no remote quote';
      return;
    }
    var cached = cache.get('q:' + item.source + ':' + item.symbol);
    if (cached) {
      results[index] = JSON.parse(cached);
      return;
    }
    pending.push({ index: index, item: item, url: url });
  });
  if (!pending.length) return results;

  var responses = UrlFetchApp.fetchAll(pending.map(function (p) {
    return {
      url: p.url,
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'Mozilla/5.0 (exfolio quote proxy)', Accept: 'application/json' }
    };
  }));
  responses.forEach(function (response, i) {
    var p = pending[i];
    var result = results[p.index];
    try {
      var code = response.getResponseCode();
      if (code !== 200) throw new Error('HTTP ' + code);
      var quote = parseQuote_(p.item, response.getContentText());
      Object.keys(quote).forEach(function (key) { result[key] = quote[key]; });
      cache.put('q:' + p.item.source + ':' + p.item.symbol, JSON.stringify(result), QUOTE_TTL_SECONDS);
    } catch (err) {
      result.error = String((err && err.message) || err);
    }
  });
  return results;
}

function isoDay_(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Daily closes from `from` (YYYY-MM-DD) to today, per item. */
function fetchHistory_(items, from) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))) throw new Error('`from` must be YYYY-MM-DD');
  var startMs = new Date(from + 'T00:00:00Z').getTime();
  return items.slice(0, 50).map(function (item) {
    var result = { source: item.source, symbol: item.symbol, points: [] };
    try {
      var symbol = encodeURIComponent(item.symbol);
      if (item.source === 'yahoo') {
        var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + symbol + '?interval=1d&period1=' +
          Math.floor(startMs / 1000) + '&period2=' + Math.floor(Date.now() / 1000);
        var chart = fetchJson_(url).chart.result[0];
        var stamps = chart.timestamp || [];
        var closes = chart.indicators.quote[0].close || [];
        var adjusted = (chart.indicators.adjclose && chart.indicators.adjclose[0].adjclose) || [];
        var offset = ((chart.meta && chart.meta.gmtoffset) || 0) * 1000;
        stamps.forEach(function (t, i) {
          if (typeof closes[i] !== 'number') return;
          var point = { date: isoDay_(t * 1000 + offset), close: closes[i] };
          if (typeof adjusted[i] === 'number') point.adjClose = adjusted[i];
          result.points.push(point);
        });
      } else if (item.source === 'binance') {
        var start = startMs;
        for (var page = 0; page < 10; page++) {
          var rows = fetchJson_('https://data-api.binance.vision/api/v3/klines?symbol=' + symbol +
            '&interval=1d&startTime=' + start + '&limit=1000');
          if (!rows.length) break;
          rows.forEach(function (row) {
            result.points.push({ date: isoDay_(Number(row[0])), close: Number(row[4]) });
          });
          if (rows.length < 1000) break;
          start = Number(rows[rows.length - 1][0]) + 86400000;
        }
      } else {
        result.error = 'Manual source has no remote history';
      }
    } catch (err) {
      result.error = String((err && err.message) || err);
    }
    return result;
  });
}

function fetchJson_(url) {
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (exfolio quote proxy)', Accept: 'application/json' }
  });
  if (response.getResponseCode() !== 200) throw new Error('HTTP ' + response.getResponseCode());
  return JSON.parse(response.getContentText());
}

// ---- Setup helpers (run from the Apps Script editor) -------------------

/** Creates a random token, stores it as EXFOLIO_TOKEN and logs it once. */
function setupToken() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('EXFOLIO_TOKEN', token);
  Logger.log('EXFOLIO_TOKEN = ' + token);
  Logger.log('Paste it into Exfolio → Settings → 後端與資料. Do not commit it or share it.');
}

/** Creates any missing table sheets, so the spreadsheet layout is visible. */
function setupSheets() {
  var ss = spreadsheet_();
  TABLES.forEach(function (name) {
    if (!ss.getSheetByName(name)) writeTable_(ss, name, []);
  });
  if (!ss.getSheetByName(META_SHEET)) setRevision_(ss, 0);
}
