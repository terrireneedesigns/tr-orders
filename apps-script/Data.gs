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
  Costs: ['cost_id', 'doc_id', 'item_id', 'category', 'description', 'supplier', 'qty', 'each_cents', 'amount_cents',
    'spent_on', 'auto', 'created_at', 'updated_at', 'voided'],
  TimeLog: ['time_id', 'doc_id', 'worked_on', 'task', 'minutes', 'note', 'created_at', 'voided'],
  PackageCosts: ['package_cost_id', 'package_id', 'category', 'description', 'amount_cents', 'sort'],
  Sessions: ['token_hash', 'created_at', 'expires_at', 'label', 'revoked'],
  Log: ['ts', 'action', 'doc_id', 'detail']
};

/** Columns stored as numbers. Everything not listed here or in BOOL_COLS is plain text. */
var NUM_COLS = {
  sort: 1, amount_cents: 1, view_count: 1, upfront_percent: 1, discount_cents: 1,
  subtotal_cents: 1, total_cents: 1, paid_cents: 1, qty: 1, step_no: 1,
  each_cents: 1, minutes: 1
};

/** Columns stored as TRUE/FALSE. */
var BOOL_COLS = {
  archived: 1, active: 1, price_editable: 1, terms_accepted: 1, voided: 1, revoked: 1, auto: 1
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

/** Tabs added after launch: created on first use, so setup() doesn't need to run again. */
var AUTO_TABS = { Costs: 1, TimeLog: 1, PackageCosts: 1 };

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh && AUTO_TABS[name]) {
    sh = ss.insertSheet(name);
    prepareTab_(sh, [], SCHEMA[name]);
  }
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
  if (v === null || v === undefined) return '';
  v = String(v);
  // A leading apostrophe makes Sheets store text that starts with "=" as text, not a formula.
  // Sheets hides the apostrophe and getValues() returns the text without it.
  return v.charAt(0) === '=' ? "'" + v : v;
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

/**
 * Replace every data row of a tab with `objs` (bulk), clearing leftover rows.
 * Only for definition tables such as TemplateLines, never for records.
 */
function rewriteTable_(name, objs) {
  var sh = sheet_(name);
  var headers = headers_(sh);
  var oldCount = Math.max(0, sh.getLastRow() - 1);
  var extra = objs.length + 1 - sh.getMaxRows();
  if (extra > 0) sh.insertRowsAfter(sh.getMaxRows(), extra);
  if (objs.length) {
    var range = sh.getRange(2, 1, objs.length, headers.length);
    var fmt = headers.map(formatFor_);
    range.setNumberFormats(objs.map(function () { return fmt; }));
    range.setValues(objs.map(function (o) { return rowFor_(headers, o); }));
  }
  if (oldCount > objs.length) {
    sh.getRange(2 + objs.length, 1, oldCount - objs.length, headers.length).clearContent();
  }
}

/**
 * Delete the rows of `name` whose `col` equals `value` (used to rewrite one order's items
 * and lines). Deletes from the bottom up, in contiguous blocks.
 */
function deleteRowsWhere_(name, col, value) {
  var sh = sheet_(name);
  var rows = readTable_(name).filter(function (r) { return r[col] === value; })
    .map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  if (!rows.length) return 0;
  // Sheets refuses to delete every non-frozen row, so keep a spare row at the end.
  if (sh.getMaxRows() - rows.length <= 1) sh.insertRowsAfter(sh.getMaxRows(), 1);
  var i = 0;
  while (i < rows.length) {
    var end = rows[i];
    var start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) { i++; start--; }
    sh.deleteRows(start, end - start + 1);
    i++;
  }
  return rows.length;
}

function findBy_(rows, col, value) {
  for (var i = 0; i < rows.length; i++) if (rows[i][col] === value) return rows[i];
  return null;
}

function maxSort_(rows) {
  return rows.reduce(function (m, r) { return Math.max(m, r.sort || 0); }, 0);
}

/* ---------- input validation (friendly messages) ---------- */

var MAX_CENTS = 10000000; // $100,000

function vStr_(v, label, max, required) {
  v = (v === null || v === undefined) ? '' : String(v).trim();
  if (required && !v) throw appError('VALIDATION', label + ' is required.');
  if (v.length > max) throw appError('VALIDATION', label + ' is too long (' + max + ' characters at most).');
  return v;
}

function vCents_(v, label) {
  var n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isInteger(n) || Math.abs(n) > MAX_CENTS) {
    throw appError('VALIDATION', label + ' must be an amount up to $100,000.');
  }
  return n;
}

function vBool_(v, dflt) {
  if (v === undefined || v === null) return !!dflt;
  return v === true || v === 'true' || v === 'TRUE';
}

function vEnum_(v, allowed, label) {
  if (allowed.indexOf(v) === -1) throw appError('VALIDATION', label + ' is not one of the choices.');
  return v;
}

function vId_(v, label) {
  if (typeof v !== 'string' || !v || v.length > 64) throw appError('VALIDATION', label + ' is missing.');
  return v;
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
  quote_expiry_days: 1, next_quote_no: 1, next_order_no: 1, hourly_rate_cents: 1
};

var CACHE_SETTINGS = 'settings_v2';
var CACHE_CATALOG = 'catalog_v2';

/** Settings added after launch: used until the key is saved, so setup() doesn't need to run again. */
var SETTING_DEFAULTS = {
  hourly_rate_cents: 2000,
  work_tasks: 'Design\nCutting\nSewing\nAirbrushing\nPatches / embroidery\nFitting\nFinishing / pressing\nPhotos / listing\nShipping / packing\nOther'
};

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
  Object.keys(SETTING_DEFAULTS).forEach(function (k) {
    if (s[k] === undefined || s[k] === '') s[k] = SETTING_DEFAULTS[k];
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

/* ---------- settings.save ---------- */

function vIntIn_(v, label, min, max) {
  var n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw appError('VALIDATION', label + ' must be a whole number from ' + min + ' to ' + max + '.');
  return String(n);
}

function vEmailSetting_(v, label) {
  var e = vStr_(v, label, 100).toLowerCase();
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw appError('VALIDATION', label + ' doesn\'t look like an email address.');
  return e;
}

/** Which settings the app may change, and how each is checked. Numbering keys are deliberately not here. */
var SETTINGS_RULES = {
  business_name: function (v) { return vStr_(v, 'Business name', 100, true); },
  phone: function (v) { return vStr_(v, 'Phone', 30); },
  email: function (v) { return vEmailSetting_(v, 'Email'); },
  website: function (v) { return vStr_(v, 'Website', 100); },
  zelle_contact: function (v) { return vStr_(v, 'Zelle number or email', 60, true); },
  zelle_display_name: function (v) { return vStr_(v, 'Zelle name', 60, true); },
  upfront_percent_default: function (v) { return vIntIn_(v, 'Upfront percent', 1, 100); },
  unpaid_flag_days: function (v) { return vIntIn_(v, 'Unpaid days', 1, 90); },
  ready_flag_days: function (v) { return vIntIn_(v, 'Ready days', 1, 90); },
  quote_expiry_days: function (v) { return vIntIn_(v, 'Quote expiry days', 1, 365); },
  notify_email: function (v) { return vEmailSetting_(v, 'Notification email'); },
  msg_quote: function (v) { return vStr_(v, 'Quote message', 1000, true); },
  msg_invoice: function (v) { return vStr_(v, 'Invoice message', 1000, true); },
  msg_receipt: function (v) { return vStr_(v, 'Receipt message', 1000, true); },
  msg_ready: function (v) { return vStr_(v, 'Ready message', 1000, true); },
  terms_title: function (v) { return vStr_(v, 'Terms title', 100, true); },
  daily_digest: function (v) { return vEnum_(v, ['on', 'off'], 'Daily summary'); },
  hourly_rate_cents: function (v) {
    var n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw appError('VALIDATION', 'Hourly rate must be from $0 to $1,000.');
    return String(n);
  },
  work_tasks: function (v) {
    var list = String(v === null || v === undefined ? '' : v).split('\n').map(function (t) { return t.trim(); })
      .filter(function (t, i, all) { return t && all.indexOf(t) === i; });
    if (!list.length) throw appError('VALIDATION', 'Keep at least one work task.');
    if (list.length > 30) throw appError('VALIDATION', 'Up to 30 work tasks.');
    list.forEach(function (t) { if (t.length > 60) throw appError('VALIDATION', 'Each work task can be up to 60 characters.'); });
    return list.join('\n');
  },
  terms: function (v) {
    if (!Array.isArray(v) || v.length > 30) throw appError('VALIDATION', 'The terms are not valid.');
    return JSON.stringify(v.map(function (t, i) {
      return { title: vStr_(t && t.title, 'Term ' + (i + 1) + ' title', 100, true), text: vStr_(t && t.text, 'Term ' + (i + 1) + ' text', 2000, true) };
    }));
  }
};

/** settings.save: { values: { key: value } } -> settings. Unknown keys are refused. */
function saveSettings_(p) {
  var values = p.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw appError('VALIDATION', 'Nothing to save.');
  var clean = {};
  Object.keys(values).forEach(function (k) {
    if (!SETTINGS_RULES[k]) throw appError('VALIDATION', 'That setting can\'t be changed here.');
    clean[k === 'terms' ? 'terms_json' : k] = SETTINGS_RULES[k](values[k]);
  });
  return withLock_(function () {
    var rows = readTable_('Settings');
    var add = [];
    Object.keys(clean).forEach(function (k) {
      var row = findBy_(rows, 'key', k);
      if (row) { row.value = clean[k]; updateRow_('Settings', row); } else add.push({ key: k, value: clean[k] });
    });
    appendRows_('Settings', add);
    clearCaches_();
    return getSettings_();
  });
}
