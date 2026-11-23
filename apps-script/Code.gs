/**
 * Code.gs: the Web App entry point (doPost router) and passcode/session auth.
 *
 * Request body (sent as text/plain to avoid a CORS preflight):
 *   { "action": "bootstrap", "token": "...", "payload": { ... } }
 * Response:
 *   { "ok": true, "data": ... }  or  { "ok": false, "error": { "code", "message" } }
 */

var API_VERSION = '0.8.0';
var SESSION_DAYS = 180;
var LOGIN_MAX_FAILS = 10;
var LOGIN_WINDOW_MS = 15 * 60 * 1000;
var LOGIN_LOCK_MS = 15 * 60 * 1000;

/** Action name -> handler. `auth: false` actions are open to anyone (keep this list short). */
function routes_() {
  return {
    'ping': { auth: false, fn: ping_ },
    'auth.login': { auth: false, fn: authLogin_ },
    'auth.logout': { auth: true, fn: authLogout_ },
    'auth.logoutAll': { auth: true, fn: authLogoutAll_ },
    'auth.changePasscode': { auth: true, fn: authChangePasscode_ },
    'bootstrap': { auth: true, fn: bootstrap_ },
    'dashboard.get': { auth: true, fn: getDashboard_ },
    'settings.save': { auth: true, fn: saveSettings_ },
    'photos.upload': { auth: true, fn: uploadPhoto_ },
    'photos.get': { auth: true, fn: getPhoto_ },
    'photos.delete': { auth: true, fn: deletePhoto_ },
    'docs.save': { auth: true, fn: saveDoc_ },
    'docs.get': { auth: true, fn: getDoc_ },
    'docs.list': { auth: true, fn: listDocs_ },
    'docs.markSent': { auth: true, fn: markSent_ },
    'docs.setStage': { auth: true, fn: setStage_ },
    'docs.void': { auth: true, fn: voidDoc_ },
    'docs.markApproved': { auth: true, fn: markApproved_ },
    'docs.convertToInvoice': { auth: true, fn: convertToInvoice_ },
    'docs.renewQuote': { auth: true, fn: renewQuote_ },
    'docs.duplicate': { auth: true, fn: duplicateDoc_ },
    'checklist.toggle': { auth: true, fn: toggleChecklist_ },
    'payments.add': { auth: true, fn: addPayment_ },
    'payments.void': { auth: true, fn: voidPayment_ },
    'public.getDocument': { auth: false, fn: publicGetDocument_ },
    'public.approveQuote': { auth: false, fn: publicApproveQuote_ },
    'public.declineQuote': { auth: false, fn: publicDeclineQuote_ },
    'customers.save': { auth: true, fn: saveCustomer_ },
    'customers.get': { auth: true, fn: getCustomer_ },
    'customers.list': { auth: true, fn: listCustomers_ },
    'catalog.saveProduct': { auth: true, fn: saveProduct_ },
    'catalog.savePackage': { auth: true, fn: savePackage_ },
    'catalog.saveTemplateLines': { auth: true, fn: saveTemplateLines_ },
    'catalog.saveAddOn': { auth: true, fn: saveAddOn_ },
    'catalog.savePatch': { auth: true, fn: savePatch_ },
    'catalog.reorder': { auth: true, fn: reorderCatalog_ },
    'backup.run': { auth: true, fn: runBackup_ }
  };
}

function doPost(e) {
  var res;
  try {
    var req = parseRequest_(e);
    var route = routes_()[req.action];
    if (!route) throw appError('BAD_REQUEST', 'Unknown action.');
    var ctx = { token: req.token || '', session: null };
    if (route.auth) ctx.session = requireSession_(ctx.token);
    var data = route.fn(req.payload || {}, ctx);
    res = { ok: true, data: data === undefined ? null : data };
  } catch (err) {
    res = { ok: false, error: publicError_(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Opening the Web App URL in a browser shows this, which is a handy "is it deployed?" check. */
function doGet() {
  return ContentService.createTextOutput('TR Orders API is running (version ' + API_VERSION + ').');
}

function parseRequest_(e) {
  var body = e && e.postData && e.postData.contents;
  if (!body) throw appError('BAD_REQUEST', 'Empty request.');
  var req;
  try {
    req = JSON.parse(body);
  } catch (err) {
    throw appError('BAD_REQUEST', 'The request was not valid.');
  }
  if (!req || typeof req.action !== 'string') throw appError('BAD_REQUEST', 'The request was not valid.');
  if (req.payload !== undefined && (typeof req.payload !== 'object' || req.payload === null)) {
    throw appError('BAD_REQUEST', 'The request was not valid.');
  }
  return req;
}

function publicError_(err) {
  if (err && err.friendly) return { code: err.code, message: err.message };
  console.error(err && err.stack ? err.stack : err);
  return { code: 'SERVER', message: 'Something went wrong. Please try again.' };
}

function ping_() {
  return { apiVersion: API_VERSION, time: nowIso_() };
}

/* ---------- auth ---------- */

function isValidPasscode_(p) {
  return typeof p === 'string' && /^\d{6,20}$/.test(p);
}

function checkPasscode_(passcode) {
  var props = PropertiesService.getScriptProperties();
  var hash = props.getProperty('PASSCODE_HASH');
  var salt = props.getProperty('PASSCODE_SALT');
  if (!hash || !salt) throw appError('SETUP', 'The app is not set up yet. Run setup() in Apps Script first.');
  return sha256Hex_(salt + String(passcode)) === hash;
}

/** Store a new passcode as SHA-256(salt + passcode) with a fresh salt, in Script Properties. */
function setPasscode_(passcode) {
  var salt = newToken_();
  PropertiesService.getScriptProperties().setProperties({
    PASSCODE_SALT: salt,
    PASSCODE_HASH: sha256Hex_(salt + passcode)
  });
}

function authLogin_(p) {
  var passcode = String(p.passcode || '');
  return withLock_(function () {
    var props = PropertiesService.getScriptProperties();
    var now = Date.now();
    var lockedUntil = Number(props.getProperty('LOGIN_LOCKED_UNTIL') || 0);
    if (lockedUntil > now) throw lockedError_(lockedUntil - now);

    if (!checkPasscode_(passcode)) {
      var fails = JSON.parse(props.getProperty('LOGIN_FAILS') || '[]').filter(function (t) {
        return t > now - LOGIN_WINDOW_MS;
      });
      fails.push(now);
      if (fails.length >= LOGIN_MAX_FAILS) {
        props.setProperty('LOGIN_LOCKED_UNTIL', String(now + LOGIN_LOCK_MS));
        props.deleteProperty('LOGIN_FAILS');
        throw lockedError_(LOGIN_LOCK_MS);
      }
      props.setProperty('LOGIN_FAILS', JSON.stringify(fails));
      throw appError('BAD_PASSCODE', 'That passcode is not right. Please try again.');
    }

    props.deleteProperty('LOGIN_FAILS');
    var token = newToken_();
    var expiresAt = addDaysIso_(SESSION_DAYS);
    appendRows_('Sessions', [{
      token_hash: sha256Hex_(token),
      created_at: nowIso_(),
      expires_at: expiresAt,
      label: String(p.label || '').slice(0, 100),
      revoked: false
    }]);
    return { token: token, expiresAt: expiresAt };
  });
}

function lockedError_(ms) {
  var mins = Math.max(1, Math.ceil(ms / 60000));
  return appError('LOCKED', 'Too many wrong tries. Please wait ' + mins + ' minutes and try again.');
}

/** Throws AUTH unless the raw token matches a live, unrevoked session. Returns the session row. */
function requireSession_(token) {
  if (!token || typeof token !== 'string') throw appError('AUTH', 'Please sign in.');
  var hash = sha256Hex_(token);
  var now = Date.now();
  var rows = readTable_('Sessions');
  for (var i = 0; i < rows.length; i++) {
    var s = rows[i];
    if (s.token_hash === hash) {
      if (!s.revoked && isoMs_(s.expires_at) > now) return s;
      break;
    }
  }
  throw appError('AUTH', 'Please sign in again.');
}

function authLogout_(p, ctx) {
  return withLock_(function () {
    var hash = ctx.session.token_hash;
    readTable_('Sessions').forEach(function (s) {
      if (s.token_hash === hash && !s.revoked) {
        s.revoked = true;
        updateRow_('Sessions', s);
      }
    });
    return { signedOut: true };
  });
}

function authLogoutAll_() {
  return withLock_(function () {
    var live = readTable_('Sessions').filter(function (s) { return !s.revoked; });
    live.forEach(function (s) { s.revoked = true; });
    updateRows_('Sessions', live);
    return { signedOut: live.length };
  });
}

function authChangePasscode_(p) {
  if (!checkPasscode_(String(p.current || ''))) {
    throw appError('BAD_PASSCODE', 'Your current passcode is not right.');
  }
  var next = String(p.next || '');
  if (!isValidPasscode_(next)) {
    throw appError('VALIDATION', 'The new passcode must be 6 to 20 digits.');
  }
  setPasscode_(next);
  return { changed: true };
}

/* ---------- bootstrap ---------- */

/** Everything the admin app needs on start, in one call. */
function bootstrap_(p) {
  // The app sends its own address so emails can link back to it (admin-only, so it can be trusted).
  var appUrl = p && typeof p.app_url === 'string' ? p.app_url : '';
  if (/^https?:\/\/[^\s"'<>]{3,300}\/$/.test(appUrl)) {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('APP_URL') !== appUrl) props.setProperty('APP_URL', appUrl);
  }
  var cat = getCatalog_();
  var customers = readTable_('Customers').map(clean_);
  customers.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return {
    apiVersion: API_VERSION,
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    settings: getSettings_(),
    products: cat.products,
    packages: cat.packages,
    templateLines: cat.templateLines,
    addOns: cat.addOns,
    patches: cat.patches,
    customers: customers
  };
}

/** Simple trigger: any hand edit in the Sheet clears cached settings and catalog. */
function onEdit() {
  clearCaches_();
}
