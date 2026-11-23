/**
 * Data.gs: sheet read/write helpers, IDs, hashing, time, locks, caching.
 *
 * Every tab has a header row. Code always maps columns by header name (read
 * from the sheet itself), so reordering columns in the Sheet is safe.
 * Money is integer cents. Timestamps are ISO 8601 strings in America/Phoenix.
 */

var TZ = 'America/Phoenix';

/** Tab names and their columns, in the order setup() creates them. */
var SCHEMA = {
  Settings: ['key', 'value'],
  Customers: ['customer_id', 'name', 'phone', 'email', 'notes', 'created_at', 'updated_at', 'archived'],
  Products: ['product_id', 'name', 'detail_form', 'active', 'sort', 'description'],
  Packages: ['package_id', 'product_id', 'name', 'price_note', 'sort', 'active'],
  TemplateLines: ['template_line_id', 'package_id', 'label', 'amount_cents', 'kind', 'sort'],
  AddOns: ['addon_id', 'product_id', 'label', 'amount_cents', 'price_editable', 'rule', 'sort', 'active'],
  Patches: ['patch_no', 'name', 'size', 'tier', 'group', 'active', 'photo_file_id'],
  Documents: [
    'doc_id', 'public_id', 'type', 'number', 'customer_id', 'status', 'stage', 'fulfillment',
    'created_at', 'updated_at', 'sent_at', 'sent_method',
    'first_viewed_at', 'last_viewed_at', 'view_count', 'expires_at',
    'approved_at', 'approved_name', 'terms_accepted', 'declined_at', 'decline_note',
    'from_quote_id', 'converted_invoice_id', 'est_ready_date', 'ready_at', 'completed_at',
    'upfront_percent', 'discount_cents', 'discount_label',
    'subtotal_cents', 'total_cents', 'paid_cents',
    'customer_note', 'internal_notes', 'void_reason'
  ],
  DocItems: ['item_id', 'doc_id', 'product_id', 'package_id', 'title', 'qty', 'sort', 'details_json'],
  DocLines: ['line_id', 'item_id', 'doc_id', 'label', 'amount_cents', 'kind', 'addon_id', 'sort'],
  Payments: ['payment_id', 'doc_id', 'amount_cents', 'method', 'paid_on', 'note', 'created_at', 'voided'],
  Checklist: ['doc_id', 'item_id', 'step_no', 'label', 'done_at'],
  Photos: ['photo_id', 'doc_id', 'item_id', 'drive_file_id', 'caption', 'created_at'],
  Sessions: ['token_hash', 'created_at', 'expires_at', 'label', 'revoked'],
  Log: ['ts', 'action', 'doc_id', 'detail']
};

/** Columns stored as numbers. Everything not listed here or in BOOL_COLS is plain text. */
var NUM_COLS = {
  sort: 1, amount_cents: 1, view_count: 1, upfront_percent: 1, discount_cents: 1,
  subtotal_cents: 1, total_cents: 1, paid_cents: 1, qty: 1, step_no: 1
};

/** Columns stored as TRUE/FALSE. */
var BOOL_COLS = {
  archived: 1, active: 1, price_editable: 1, terms_accepted: 1, voided: 1, revoked: 1
};

/* ---------- errors ---------- */

/** An error whose message is safe and friendly enough to show in the app. */
function appError(code, message) {
  var e = new Error(message);
  e.code = code;
  e.friendly = true;
  return e;
}

/* ---------- time ---------- */

function nowIso_() {
  return isoOf_(new Date());
}

function isoOf_(date) {
  return Utilities.formatDate(date, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function todayStr_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function addDaysIso_(days) {
  return isoOf_(new Date(Date.now() + days * 86400000));
}

/** Milliseconds for an ISO string, or 0 if empty/invalid. */
function isoMs_(iso) {
  if (!iso) return 0;
  var t = new Date(iso).getTime();
  return isNaN(t) ? 0 : t;
}

/* ---------- IDs and hashing ---------- */

function uuidHex_() {
  return Utilities.getUuid().replace(/-/g, '');
}

/** Short internal ID, e.g. "C_3f9a1b2c4d5e6f70". */
function newId_(prefix) {
  return prefix + '_' + uuidHex_().slice(0, 16);
}

/** 43-char URL-safe random ID for customer links (two UUIDs, base64url). */
function newPublicId_() {
  var hex = uuidHex_() + uuidHex_();
  var bytes = [];
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    bytes.push(b > 127 ? b - 256 : b);
  }
  return base64Url_(bytes);
}

/** Random 32-byte token (base64url), from three UUIDs hashed together. */
function newToken_() {
  var seed = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + Date.now();
  return base64Url_(sha256Bytes_(seed));
}

function sha256Bytes_(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
}

function sha256Hex_(str) {
  return sha256Bytes_(str).map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function base64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

/* ---------- locks ---------- */

/** Run fn while holding the script lock (use for anything that reads then writes). */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw appError('BUSY', 'The app is busy right now. Please try again in a moment.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ---------- sheets ---------- */

var HEADER_CACHE_ = {};

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw appError('SETUP', 'The "' + name + '" tab is missing. Run setup() in Apps Script.');
  return sh;
}

function headers_(sh) {
  var name = sh.getName();
  if (!HEADER_CACHE_[name]) {
    var lastCol = sh.getLastColumn();
    HEADER_CACHE_[name] = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  }
  return HEADER_CACHE_[name];
}

function formatFor_(col) {
  if (NUM_COLS[col]) return '0';
  if (BOOL_COLS[col]) return 'General';
  return '@'; // plain text, so "01", phone numbers and dates are stored exactly as typed
}

function cellIn_(col, v) {
  if (BOOL_COLS[col]) return v === true || v === 'TRUE' || v === 'true';
  if (NUM_COLS[col]) return (v === '' || v === null || v === undefined) ? '' : Number(v);
  return (v === null || v === undefined) ? '' : String(v);
}

function cellOut_(col, v) {
  if (BOOL_COLS[col]) return v === true || v === 'TRUE' || v === 'true';
  if (NUM_COLS[col]) return (v === '' || v === null) ? 0 : Number(v);
  if (v instanceof Date) return isoOf_(v);
  return v === null || v === undefined ? '' : String(v);
}

/** All data rows of a tab as objects. Each object has a hidden `_row` (sheet row number). */
function readTable_(name) {
  var sh = sheet_(name);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var headers = headers_(sh);
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = cellOut_(headers[c], row[c]);
    }
    Object.defineProperty(obj, '_row', { value: r + 2, enumerable: false, writable: true });
    out.push(obj);
  }
  return out;
}

function rowFor_(headers, obj) {
  return headers.map(function (h) { return cellIn_(h, obj[h]); });
}

/** Append objects as new rows (bulk). */
function appendRows_(name, objs) {
  if (!objs || !objs.length) return;
  var sh = sheet_(name);
  var headers = headers_(sh);
  var start = sh.getLastRow() + 1;
  var extra = start + objs.length - 1 - sh.getMaxRows();
  if (extra > 0) sh.insertRowsAfter(sh.getMaxRows(), extra);
  var range = sh.getRange(start, 1, objs.length, headers.length);
  var fmt = headers.map(formatFor_);
  range.setNumberFormats(objs.map(function () { return fmt; }));
  range.setValues(objs.map(function (o) { return rowFor_(headers, o); }));
  objs.forEach(function (o, i) {
    Object.defineProperty(o, '_row', { value: start + i, enumerable: false, writable: true });
  });
}

/** Rewrite one existing row from an object returned by readTable_ (uses its _row). */
function updateRow_(name, obj) {
  if (!obj._row) throw new Error('updateRow_ needs an object read from the sheet');
  var sh = sheet_(name);
  var headers = headers_(sh);
  var range = sh.getRange(obj._row, 1, 1, headers.length);
  range.setNumberFormats([headers.map(formatFor_)]);
  range.setValues([rowFor_(headers, obj)]);
}

/** Rewrite many existing rows (objects from readTable_). */
function updateRows_(name, objs) {
  objs.forEach(function (o) { updateRow_(name, o); });
}

/** Copy of an object without hidden fields, safe to return to the admin app. */
function clean_(obj) {
  var out = {};
  Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
  return out;
}

function bySort_(a, b) {
  return (a.sort || 0) - (b.sort || 0);
}

/* ---------- settings (cached) ---------- */

var NUMERIC_SETTINGS = {
  upfront_percent_default: 1, unpaid_flag_days: 1, ready_flag_days: 1,
  quote_expiry_days: 1, next_quote_no: 1, next_order_no: 1
};

var CACHE_SETTINGS = 'settings_v1';
var CACHE_CATALOG = 'catalog_v1';

/** Settings as an object. Numeric settings are numbers; terms_json is parsed into `terms`. */
function getSettings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_SETTINGS);
  if (hit) return JSON.parse(hit);
  var s = {};
  readTable_('Settings').forEach(function (r) {
    if (!r.key) return;
    s[r.key] = NUMERIC_SETTINGS[r.key] ? Number(r.value) : r.value;
  });
  try {
    s.terms = JSON.parse(s.terms_json || '[]');
  } catch (err) {
    s.terms = [];
  }
  delete s.terms_json;
  cache.put(CACHE_SETTINGS, JSON.stringify(s), 21600);
  return s;
}

function clearCaches_() {
  CacheService.getScriptCache().removeAll([CACHE_SETTINGS, CACHE_CATALOG]);
}

/* ---------- audit log ---------- */

function logEvent_(action, docId, detail) {
  appendRows_('Log', [{ ts: nowIso_(), action: action, doc_id: docId || '', detail: detail || '' }]);
}
