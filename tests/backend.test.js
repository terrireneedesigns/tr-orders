#!/usr/bin/env node
/**
 * Local test for the Apps Script back end, using small fakes of the Google services.
 * Run with:  node tests/backend.test.js
 * No npm packages needed. This does not replace testing the real deployment,
 * but it catches most logic mistakes before you paste code into Apps Script.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

/* ---------------- fakes ---------------- */

function makeSheet(name) {
  const s = {
    name, data: [], fmt: {}, maxRows: 1000,
    getName: () => name,
    getMaxRows: () => s.maxRows,
    insertRowsAfter: (_r, n) => { s.maxRows += n; },
    deleteRows: (start, n) => {
      if (start < 2 || n < 1) throw new Error('bad deleteRows');
      if (s.maxRows - n < 2) throw new Error('This action would delete all non-frozen rows in the sheet');
      s.data.splice(start - 1, n); s.maxRows -= n;
    },
    getLastRow: () => {
      for (let r = s.data.length - 1; r >= 0; r--) {
        if ((s.data[r] || []).some(v => v !== '' && v !== undefined)) return r + 1;
      }
      return 0;
    },
    getLastColumn: () => Math.max(0, ...s.data.map(row => {
      let c = (row || []).length; while (c > 0 && (row[c - 1] === '' || row[c - 1] === undefined)) c--; return c;
    })),
    setFrozenRows: () => {},
    getRange: (r, c, nr = 1, nc = 1) => makeRange(s, r, c, nr, nc)
  };
  return s;
}

function makeRange(s, r, c, nr, nc) {
  if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`Bad range ${r},${c},${nr},${nc}`);
  if (r + nr - 1 > s.maxRows) throw new Error(`Range past max rows on ${s.name}`);
  const key = (i, j) => `${r + i},${c + j}`;
  const rg = {
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
      const v = (s.data[r - 1 + i] || [])[c - 1 + j]; return v === undefined ? '' : v;
    })),
    setValues: (vals) => {
      if (vals.length !== nr || vals.some(row => row.length !== nc)) throw new Error('setValues size mismatch');
      vals.forEach((row, i) => row.forEach((v, j) => {
        const f = s.fmt[key(i, j)] || s.fmt[`col${c + j}`];
        // Mimic Sheets: numeric-looking text in a non-text cell becomes a number.
        if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1); // Sheets hides a leading apostrophe
        else if (typeof v === 'string' && v.charAt(0) === '=') throw new Error('Formula written to sheet: ' + v);
        else if (f !== '@' && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
        s.data[r - 1 + i] = s.data[r - 1 + i] || [];
        s.data[r - 1 + i][c - 1 + j] = v;
      }));
      return rg;
    },
    setNumberFormat: (f) => {
      if (nr > 100) { for (let j = 0; j < nc; j++) s.fmt[`col${c + j}`] = f; } else {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.fmt[key(i, j)] = f;
      }
      return rg;
    },
    setNumberFormats: (fs2) => { fs2.forEach((row, i) => row.forEach((f, j) => { s.fmt[key(i, j)] = f; })); return rg; },
    clearContent: () => {
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { if (s.data[r - 1 + i]) s.data[r - 1 + i][c - 1 + j] = ''; }
      return rg;
    },
    setFontWeight: () => rg, setBackground: () => rg, setFontColor: () => rg
  };
  return rg;
}

function makeEnv(uiAnswers) {
  const sheets = [makeSheet('Sheet1')];
  const props = {};
  const cache = {};
  const triggers = [];
  const files = {};
  let idn = 0;
  const newFolder = (name, parent) => {
    const f = {
      id: 'folder' + (++idn), name, parent, trashed: false, children: [],
      getId: () => f.id, isTrashed: () => f.trashed, getName: () => name,
      getFoldersByName: (n) => iter(f.children.filter(x => x.name === n && x.kind === 'folder')),
      createFolder: (n) => { const c = newFolder(n, f); c.kind = 'folder'; f.children.push(c); return c; },
      getFilesByName: (n) => iter(f.children.filter(x => x.kind === 'file' && x.name === n && !x.trashed)),
      createFile: (blob) => {
        const file = { kind: 'file', id: 'file' + (++idn), name: blob.getName(), blob, trashed: false, created: new Date(),
          getId() { return this.id; }, getName() { return this.name; }, getBlob() { return this.blob; },
          getThumbnail() { return thumbsWork ? newBlob(this.blob.getBytes().slice(0, 10), 'image/png', 'thumb') : null; },
          setTrashed(v) { this.trashed = v; }, isTrashed() { return this.trashed; }, getDateCreated() { return this.created; }, getUrl() { return 'https://drive/' + this.id; } };
        f.children.push(file); files[file.id] = file; return file;
      },
      getFiles: () => iter(f.children.filter(x => x.kind === 'file' && !x.trashed))
    };
    files[f.id] = f;
    return f;
  };
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const newBlob = (bytes, mime, name) => ({ getBytes: () => bytes.slice(), getContentType: () => mime, getName: () => name });
  let thumbsWork = true;
  const mail = [];
  let mailWorks = true;
  const root = newFolder('My Drive');
  const ss = {
    getId: () => 'ss1', getUrl: () => 'https://docs.google.com/spreadsheets/d/ss1', tz: '',
    setSpreadsheetTimeZone: (tz) => { ss.tz = tz; },
    getSheetByName: (n) => sheets.find(x => x.name === n) || null,
    insertSheet: (n) => { const sh = makeSheet(n); sheets.push(sh); return sh; },
    getSheets: () => sheets.slice(),
    deleteSheet: (sh) => { sheets.splice(sheets.indexOf(sh), 1); }
  };
  const answers = uiAnswers.slice();
  const ui = {
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    alerts: [],
    alert: (title, msg) => {
      ui.alerts.push(title + ': ' + (msg || ''));
      if (msg && msg.indexOf('Do you want to change it?') !== -1) return answers.shift();
      return 'OK';
    },
    prompt: () => { const a = answers.shift(); return { getSelectedButton: () => a === null ? 'CANCEL' : 'OK', getResponseText: () => a || '' }; }
  };
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ui },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      setProperties: (o) => { Object.keys(o).forEach(k => { props[k] = String(o[k]); }); },
      deleteProperty: (k) => { delete props[k]; }
    }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => (k in cache ? cache[k] : null),
      put: (k, v) => { if (v.length > 100000) throw new Error('too big'); cache[k] = v; },
      removeAll: (ks) => ks.forEach(k => delete cache[k])
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(str, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      base64Decode: (str) => Array.from(Buffer.from(str, 'base64')).map(b => (b > 127 ? b - 256 : b)),
      base64Encode: (bytes) => Buffer.from(bytes.map(b => b & 255)).toString('base64'),
      newBlob: (bytes, mime, name) => newBlob(bytes, mime, name),
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      formatDate: (d, tz, pat) => {
        const t = new Date(d.getTime() - 7 * 3600e3); const p = n => String(n).padStart(2, '0');
        return pat.replace('yyyy', t.getUTCFullYear()).replace('MM', p(t.getUTCMonth() + 1)).replace('dd', p(t.getUTCDate()))
          .replace("'T'", 'T').replace('HH', p(t.getUTCHours())).replace('mm', p(t.getUTCMinutes())).replace('ss', p(t.getUTCSeconds())).replace('XXX', '-07:00');
      }
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => {
        const t = { fn, getHandlerFunction: () => fn };
        const b = { timeBased: () => b, atHour: (h) => { t.hour = h; return b; }, everyDays: () => b, inTimezone: (z) => { t.tz = z; return b; }, create: () => { triggers.push(t); return t; } };
        return b;
      }
    },
    DriveApp: {
      getRootFolder: () => root,
      createFolder: (n) => { const f = root.createFolder(n); return f; },
      getFolderById: (id) => { if (!files[id]) throw new Error('no folder'); return files[id]; },
      getFileById: (id) => (files[id] && files[id].kind === 'file' ? files[id] : {
        makeCopy: (name, folder) => {
          const f = { kind: 'file', name, trashed: false, created: new Date(), getName: () => name, getUrl: () => 'https://drive/' + name,
            getDateCreated: () => f.created, setTrashed: (v) => { f.trashed = v; } };
          folder.children.push(f); return f;
        }
      })
    },
    MailApp: {
      sendEmail: (o) => { if (!mailWorks) throw new Error('Authorization is required to perform that action.'); mail.push(o); },
      getRemainingDailyQuota: () => 100
    }
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'apps-script');
  const code = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  vm.runInContext(code, ctx, { filename: 'apps-script.gs' });
  return { ctx, ss, sheets, props, cache, triggers, ui, root, answers, mail, files,
    setMailWorks: (v) => { mailWorks = v; }, setThumbsWork: (v) => { thumbsWork = v; } };
}

// When required from another script (for example a local fake server), just export the fakes.
if (require.main !== module) {
  module.exports = { makeEnv };
  return;
}

/* ---------------- tiny test runner ---------------- */

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'not equal') + `: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

function call(env, action, payload, token) {
  const body = JSON.stringify({ action, token, payload });
  return JSON.parse(env.ctx.doPost({ postData: { contents: body } }).getContent());
}

/* ---------------- tests ---------------- */

console.log('TR Orders back end (mock Google services)');
const env = makeEnv(['123456', '123456']);
env.ctx.setup();
const table = (n) => vm.runInContext(`readTable_(${JSON.stringify(n)})`, env.ctx);

test('setup creates every tab with its headers, and removes blank Sheet1', () => {
  const schema = vm.runInContext('SCHEMA', env.ctx);
  Object.keys(schema).forEach(n => {
    const sh = env.ss.getSheetByName(n); ok(sh, 'missing tab ' + n);
    eq(sh.data[0], schema[n], 'headers for ' + n);
  });
  ok(!env.ss.getSheetByName('Sheet1'), 'Sheet1 should be removed');
  eq(env.ss.tz, 'America/Phoenix');
});

test('settings seeded with typed values and parsed terms', () => {
  const s = vm.runInContext('getSettings_()', env.ctx);
  eq(s.zelle_contact, '623-523-7472'); eq(s.zelle_display_name, 'THERESA ODOM');
  eq(s.phone, '623-521-6235'); eq(s.next_order_no, 1001); eq(s.upfront_percent_default, 100);
  eq(s.terms.length, 8); eq(s.terms[0].title, 'Payment');
  ok(s.msg_invoice.indexOf('{total}') !== -1);
});

test('package template lines total $275 / $335 / $405 (acceptance 1-3)', () => {
  const pk = table('Packages'), tl = table('TemplateLines');
  const sum = (name) => tl.filter(l => l.package_id === pk.find(p => p.name === name).package_id).reduce((a, l) => a + l.amount_cents, 0);
  eq(sum('Standard'), 27500); eq(sum('Premium'), 33500); eq(sum("Collector's"), 40500);
  eq(tl.filter(l => l.kind === 'savings').length, 3);
});

test('hat and purse have one empty Custom package each', () => {
  const prods = table('Products'), pk = table('Packages');
  ['Custom Hat', 'Custom Purse'].forEach(n => {
    const p = prods.find(x => x.name === n); eq(p.detail_form, 'simple');
    const mine = pk.filter(x => x.product_id === p.product_id); eq(mine.map(x => x.name), ['Custom']);
  });
});

test('add-ons seeded with rules and editable flag', () => {
  const a = table('AddOns'); eq(a.length, 6);
  eq(a.filter(x => x.rule === 'extra_patch').length, 4);
  const own = a.find(x => x.label.startsWith('Your own')); eq(own.price_editable, true); eq(own.amount_cents, 2000);
  eq(a.find(x => x.rule === 'left_sleeve').amount_cents, 1000);
});

test('45 patches, numbers kept as text ("01"), tiers right', () => {
  const p = table('Patches'); eq(p.length, 45); eq(p[0].patch_no, '01'); eq(typeof p[0].patch_no, 'string');
  eq(p.filter(x => x.tier === 'premium').length, 10);
  eq(p.find(x => x.patch_no === '30').tier, 'premium');
});

test('passcode stored as salted hash in Script Properties, never in the Sheet', () => {
  ok(/^[0-9a-f]{64}$/.test(env.props.PASSCODE_HASH)); ok(env.props.PASSCODE_SALT);
  const all = JSON.stringify(env.sheets.map(s => s.data)); ok(all.indexOf('123456') === -1);
});

test('folders and nightly trigger created', () => {
  ok(env.props.ROOT_FOLDER_ID && env.props.PHOTOS_FOLDER_ID && env.props.BACKUPS_FOLDER_ID);
  eq(env.triggers.length, 1); eq(env.triggers[0].fn, 'nightlyBackup'); eq(env.triggers[0].hour, 2); eq(env.triggers[0].tz, 'America/Phoenix');
});

test('setup is safe to re-run (no duplicates, keeps passcode)', () => {
  const before = env.props.PASSCODE_HASH;
  env.answers.push('NO');
  env.ctx.setup();
  eq(table('Products').length, 3); eq(table('Patches').length, 45); eq(table('Settings').length, 21);
  eq(env.triggers.length, 1); eq(env.props.PASSCODE_HASH, before);
  eq(env.root.children.filter(c => c.name === 'TR Orders').length, 1);
});

test('GET shows the API is running', () => {
  ok(env.ctx.doGet().getContent().indexOf('TR Orders API is running') === 0);
});

test('ping works without a token; bad requests give friendly errors', () => {
  eq(call(env, 'ping', {}).ok, true);
  eq(call(env, 'nope', {}).error.code, 'BAD_REQUEST');
  const r = JSON.parse(env.ctx.doPost({ postData: { contents: 'not json' } }).getContent());
  eq(r.error.code, 'BAD_REQUEST');
});

test('bootstrap requires a session', () => {
  eq(call(env, 'bootstrap', {}).error.code, 'AUTH');
  eq(call(env, 'bootstrap', {}, 'made-up-token').error.code, 'AUTH');
});

let token;
test('login with wrong passcode fails, right one returns a 180-day token', () => {
  eq(call(env, 'auth.login', { passcode: '000000' }).error.code, 'BAD_PASSCODE');
  const r = call(env, 'auth.login', { passcode: '123456', label: 'Test iPhone' });
  eq(r.ok, true); token = r.data.token;
  ok(token.length >= 43, 'token length');
  const days = (new Date(r.data.expiresAt) - Date.now()) / 86400000; ok(days > 179 && days < 181, 'expiry ~180 days');
  const sess = table('Sessions'); eq(sess.length, 1); ok(sess[0].token_hash !== token, 'only hash stored');
  eq(sess[0].label, 'Test iPhone');
});

test('bootstrap returns settings, catalog and customers', () => {
  const r = call(env, 'bootstrap', {}, token); eq(r.ok, true);
  const d = r.data;
  eq(d.products.map(p => p.name), ['Custom Bomber Jacket', 'Custom Hat', 'Custom Purse']);
  eq(d.packages.length, 5); eq(d.templateLines.length, 7 + 8 + 9); eq(d.addOns.length, 6);
  eq(d.patches.length, 45); eq(d.patches[0].patch_no, '01'); eq(d.patches[44].patch_no, '45');
  eq(d.customers, []); eq(d.settings.business_name, 'Terri Renee Evolvé');
  ok(d.sheetUrl); ok(!('_row' in d.products[0]));
});

test('catalog is cached, and onEdit clears the cache', () => {
  ok(env.cache.catalog_v1 && env.cache.settings_v1);
  env.ctx.onEdit({}); ok(!env.cache.catalog_v1 && !env.cache.settings_v1);
});

test('logout revokes only that session; logoutAll revokes all', () => {
  const t2 = call(env, 'auth.login', { passcode: '123456' }).data.token;
  eq(call(env, 'auth.logout', {}, token).ok, true);
  eq(call(env, 'bootstrap', {}, token).error.code, 'AUTH');
  eq(call(env, 'bootstrap', {}, t2).ok, true);
  const t3 = call(env, 'auth.login', { passcode: '123456' }).data.token;
  eq(call(env, 'auth.logoutAll', {}, t3).data.signedOut, 2);
  eq(call(env, 'bootstrap', {}, t2).error.code, 'AUTH');
});

test('expired session is rejected', () => {
  const t = call(env, 'auth.login', { passcode: '123456' }).data.token;
  const sess = table('Sessions'); const last = sess[sess.length - 1];
  last.expires_at = '2020-01-01T00:00:00-07:00';
  vm.runInContext('updateRow_', env.ctx)('Sessions', last);
  eq(call(env, 'bootstrap', {}, t).error.code, 'AUTH');
});

test('change passcode needs the current one', () => {
  const t = call(env, 'auth.login', { passcode: '123456' }).data.token;
  eq(call(env, 'auth.changePasscode', { current: '111111', next: '654321' }, t).error.code, 'BAD_PASSCODE');
  eq(call(env, 'auth.changePasscode', { current: '123456', next: '12' }, t).error.code, 'VALIDATION');
  eq(call(env, 'auth.changePasscode', { current: '123456', next: '654321' }, t).ok, true);
  eq(call(env, 'auth.login', { passcode: '654321' }).ok, true);
});

test('11 wrong passcodes lock login for 15 minutes, even for the right one (acceptance 19)', () => {
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push(call(env, 'auth.login', { passcode: '999999' }).error.code);
  eq(codes.slice(0, 9).every(c => c === 'BAD_PASSCODE'), true, 'first 9 are wrong-passcode');
  eq(codes[9], 'LOCKED'); eq(codes[10], 'LOCKED');
  const r = call(env, 'auth.login', { passcode: '654321' }); eq(r.error.code, 'LOCKED');
  ok(/15 minutes/.test(r.error.message));
  env.props.LOGIN_LOCKED_UNTIL = String(Date.now() - 1); // time passes
  eq(call(env, 'auth.login', { passcode: '654321' }).ok, true);
});

test('backup makes a dated copy, replaces same-day copy, removes ones older than 30 days (acceptance 21)', () => {
  const t = call(env, 'auth.login', { passcode: '654321' }).data.token;
  const folder = env.root.children.find(c => c.name === 'TR Orders').children.find(c => c.name === 'Backups');
  folder.children.push({ kind: 'file', name: 'TR Orders Data 2020-01-01', trashed: false, created: new Date('2020-01-01'),
    getName() { return this.name; }, getDateCreated() { return this.created; }, setTrashed(v) { this.trashed = v; } });
  const r1 = call(env, 'backup.run', {}, t); eq(r1.ok, true); eq(r1.data.removed, 1);
  ok(/^TR Orders Data \d{4}-\d{2}-\d{2}$/.test(r1.data.name));
  env.ctx.nightlyBackup();
  const live = folder.children.filter(f => !f.trashed); eq(live.length, 1, 'one live copy for today');
});

test('new rows keep phone numbers and numeric-looking text as text', () => {
  vm.runInContext(`appendRows_('Customers', [{customer_id:'C_1', name:'Test', phone:'6235216235', email:'', notes:'', created_at: nowIso_(), updated_at: nowIso_(), archived:false}])`, env.ctx);
  const c = table('Customers')[0]; eq(c.phone, '6235216235'); eq(typeof c.phone, 'string'); eq(c.archived, false);
});

/* ---------------- milestone 3: catalog and customers ---------------- */

const tok = () => call(env, 'auth.login', { passcode: '654321' }).data.token;
let t3;
test('catalog and customer actions need a session', () => {
  ['customers.save', 'customers.list', 'catalog.saveProduct', 'catalog.savePatch', 'catalog.reorder'].forEach(a => {
    eq(call(env, a, {}).error.code, 'AUTH', a);
  });
  t3 = tok();
});

let newProductId;
test('new product gets one "Custom" package; validation is friendly', () => {
  eq(call(env, 'catalog.saveProduct', { name: '' }, t3).error.message, 'Product name is required.');
  eq(call(env, 'catalog.saveProduct', { name: 'Tote', detail_form: 'robot' }, t3).error.code, 'VALIDATION');
  const r = call(env, 'catalog.saveProduct', { name: 'Custom Tote', detail_form: 'simple' }, t3);
  eq(r.ok, true); newProductId = r.data.id;
  const p = r.data.catalog.products.find(x => x.product_id === newProductId);
  eq(p.sort, 4); eq(p.active, true);
  eq(r.data.catalog.packages.filter(k => k.product_id === newProductId).map(k => k.name), ['Custom']);
});

test('edit product keeps its id; hide (inactive) works', () => {
  const r = call(env, 'catalog.saveProduct', { product_id: newProductId, name: 'Custom Tote Bag', detail_form: 'simple', active: false }, t3);
  const p = r.data.catalog.products.find(x => x.product_id === newProductId);
  eq(p.name, 'Custom Tote Bag'); eq(p.active, false);
  eq(call(env, 'catalog.saveProduct', { product_id: 'PRD_nope', name: 'x' }, t3).error.code, 'NOT_FOUND');
});

test('package with lines saves in one call; other packages untouched', () => {
  const before = table('TemplateLines').length;
  const r = call(env, 'catalog.savePackage', { product_id: newProductId, name: 'Deluxe', price_note: '$120', lines: [
    { label: 'Tote bag', amount_cents: 4000, kind: 'base' },
    { label: 'Two patches', amount_cents: 8500, kind: 'base' },
    { label: 'Package savings', amount_cents: -500, kind: 'savings' }
  ] }, t3);
  eq(r.ok, true);
  const lines = r.data.catalog.templateLines.filter(l => l.package_id === r.data.id);
  eq(lines.map(l => l.amount_cents), [4000, 8500, -500]); eq(lines.map(l => l.sort), [1, 2, 3]);
  eq(table('TemplateLines').length, before + 3);
  // jacket Standard still $275
  const std = table('Packages').find(p => p.name === 'Standard');
  eq(table('TemplateLines').filter(l => l.package_id === std.package_id).reduce((a, l) => a + l.amount_cents, 0), 27500);
});

test('saveTemplateLines replaces one package (fewer lines clears leftover rows)', () => {
  const pk = table('Packages').find(p => p.name === 'Deluxe');
  const r = call(env, 'catalog.saveTemplateLines', { package_id: pk.package_id, lines: [{ label: 'All in', amount_cents: 11500, kind: 'base' }] }, t3);
  eq(r.ok, true);
  eq(table('TemplateLines').filter(l => l.package_id === pk.package_id).length, 1);
  eq(table('TemplateLines').length, 24 + 1, 'seeded 24 + 1');
  const bad = call(env, 'catalog.saveTemplateLines', { package_id: pk.package_id, lines: [{ label: 'x', amount_cents: 12.5 }] }, t3);
  eq(bad.error.message, 'Line 1 amount must be an amount up to $100,000.');
  eq(call(env, 'catalog.saveTemplateLines', { package_id: pk.package_id, lines: [{ label: 'x', amount_cents: 10000001 }] }, t3).error.code, 'VALIDATION');
  eq(call(env, 'catalog.saveTemplateLines', { package_id: pk.package_id, lines: [{ label: 'x', amount_cents: 1, kind: 'addon' }] }, t3).error.code, 'VALIDATION');
});

test('add-ons: add, edit price/rule, bad rule rejected', () => {
  const r = call(env, 'catalog.saveAddOn', { product_id: newProductId, label: 'Monogram', amount_cents: 1500 }, t3);
  eq(r.ok, true);
  const a = r.data.catalog.addOns.find(x => x.addon_id === r.data.id); eq(a.rule, ''); eq(a.price_editable, false); eq(a.sort, 1);
  const r2 = call(env, 'catalog.saveAddOn', { addon_id: r.data.id, label: 'Monogram', amount_cents: 1800, price_editable: true, rule: 'extra_patch' }, t3);
  const a2 = r2.data.catalog.addOns.find(x => x.addon_id === r.data.id); eq(a2.amount_cents, 1800); eq(a2.price_editable, true); eq(a2.rule, 'extra_patch');
  eq(call(env, 'catalog.saveAddOn', { product_id: newProductId, label: 'x', amount_cents: 1, rule: 'zap' }, t3).error.code, 'VALIDATION');
});

test('patches: add, rename number, duplicates refused, numbers stay text', () => {
  const r = call(env, 'catalog.savePatch', { patch_no: '46', name: 'New patch', tier: 'premium', group: 'Large and custom-ordered' }, t3);
  eq(r.ok, true); eq(r.data.catalog.patches[r.data.catalog.patches.length - 1].patch_no, '46');
  eq(call(env, 'catalog.savePatch', { patch_no: '01', name: 'Clash' }, t3).error.message, 'Patch No. 01 already exists. Choose another number.');
  const r2 = call(env, 'catalog.savePatch', { original_patch_no: '46', patch_no: '046', name: 'New patch', tier: 'premium', group: 'Large and custom-ordered', active: false }, t3);
  eq(r2.ok, true);
  const p = table('Patches').find(x => x.patch_no === '046'); ok(p, 'renamed'); eq(p.active, false);
  ok(!table('Patches').find(x => x.patch_no === '46'));
  eq(call(env, 'catalog.savePatch', { patch_no: 'a b', name: 'x' }, t3).error.code, 'VALIDATION');
  eq(call(env, 'catalog.savePatch', { patch_no: '50', name: 'x', group: 'Huge' }, t3).error.code, 'VALIDATION');
});

test('reorder sets sort in the given order', () => {
  const ids = table('Products').map(p => p.product_id).reverse();
  const r = call(env, 'catalog.reorder', { kind: 'products', ids }, t3);
  eq(r.data.catalog.products.map(p => p.product_id), ids);
  eq(call(env, 'catalog.reorder', { kind: 'Sessions', ids: [] }, t3).error.code, 'VALIDATION');
});

test('text starting with "=" is stored as text, not a formula', () => {
  const r = call(env, 'catalog.saveAddOn', { product_id: newProductId, label: '=HYPERLINK("x")', amount_cents: 100 }, t3);
  eq(r.ok, true);
  ok(table('AddOns').some(a => a.label === '=HYPERLINK("x")'));
});

let custId;
test('customers: add cleans phone and email; name required', () => {
  eq(call(env, 'customers.save', { name: ' ' }, t3).error.message, 'Name is required.');
  eq(call(env, 'customers.save', { name: 'A', email: 'nope' }, t3).error.code, 'VALIDATION');
  const r = call(env, 'customers.save', { name: 'Gloria Hayes', phone: '(602) 555-0142', email: ' Gloria@Example.com ', notes: 'Size L, likes red' }, t3);
  eq(r.data.saved, true); custId = r.data.customer.customer_id;
  eq(r.data.customer.phone, '602-555-0142'); eq(r.data.customer.email, 'gloria@example.com');
  eq(r.data.customer.stats.orders, 0); eq(r.data.customer.stats.repeat, false);
});

test('adding a duplicate phone or email asks first; force saves anyway (5.9)', () => {
  const byPhone = call(env, 'customers.save', { name: 'G. Hayes', phone: '1-602-555-0142' }, t3);
  eq(byPhone.data.saved, false); eq(byPhone.data.duplicates.map(c => c.customer_id), [custId]);
  const byEmail = call(env, 'customers.save', { name: 'Glo', email: 'GLORIA@example.com' }, t3);
  eq(byEmail.data.saved, false);
  eq(table('Customers').length, 2, 'nothing saved yet');  // includes the earlier phone-format test row
  const forced = call(env, 'customers.save', { name: 'Glo', email: 'gloria@example.com', force: true }, t3);
  eq(forced.data.saved, true);
  // editing an existing customer never triggers the duplicate check
  const ed = call(env, 'customers.save', { customer_id: custId, name: 'Gloria Hayes', phone: '602-555-0142', email: 'gloria@example.com', notes: 'Size L' }, t3);
  eq(ed.data.saved, true); eq(ed.data.customer.notes, 'Size L');
});

test('archive hides nothing server side but is flagged; list sorted by name', () => {
  const r = call(env, 'customers.save', { customer_id: custId, name: 'Gloria Hayes', archived: true }, t3);
  eq(r.data.customer.archived, true);
  const list = call(env, 'customers.list', {}, t3).data;
  eq(list.map(c => c.name), list.map(c => c.name).slice().sort((a, b) => a.localeCompare(b)));
  ok(list.find(c => c.customer_id === custId).archived);
  const back = call(env, 'customers.save', { customer_id: custId, archived: false }, t3).data.customer;
  eq(back.archived, false); eq(back.phone, '602-555-0142', 'fields not sent are kept'); eq(back.notes, 'Size L');
});

test('stats: issued invoices only; repeat = 2+ paid; has unpaid; total spent', () => {
  const base = { public_id: 'x', customer_id: custId, fulfillment: 'pickup', upfront_percent: 100, view_count: 0, discount_cents: 0, subtotal_cents: 0 };
  vm.runInContext('appendRows_', env.ctx)('Documents', [
    Object.assign({}, base, { doc_id: 'D1', type: 'invoice', number: 'TR-0901', status: 'issued', stage: 'completed', total_cents: 27500, paid_cents: 27500, created_at: '2026-10-01T10:00:00-07:00' }),
    Object.assign({}, base, { doc_id: 'D2', type: 'invoice', number: 'TR-0902', status: 'issued', stage: 'in_progress', total_cents: 34100, paid_cents: 34100, created_at: '2026-11-01T10:00:00-07:00' }),
    Object.assign({}, base, { doc_id: 'D3', type: 'invoice', number: 'TR-0903', status: 'issued', stage: 'awaiting_payment', total_cents: 33500, paid_cents: 0, created_at: '2026-11-10T10:00:00-07:00' }),
    Object.assign({}, base, { doc_id: 'D4', type: 'invoice', number: 'TR-0904', status: 'void', stage: 'cancelled', total_cents: 99900, paid_cents: 0, created_at: '2026-11-11T10:00:00-07:00' }),
    Object.assign({}, base, { doc_id: 'D5', type: 'quote', number: 'Q-0901', status: 'sent', stage: '', total_cents: 40500, paid_cents: 0, created_at: '2026-11-12T10:00:00-07:00' })
  ]);
  const g = call(env, 'customers.get', { customer_id: custId }, t3).data;
  eq(g.customer.stats, { orders: 3, paid_orders: 2, total_spent_cents: 61600, last_order_at: '2026-11-10T10:00:00-07:00', repeat: true, has_unpaid: true });
  eq(g.orders.map(o => o.number), ['Q-0901', 'TR-0904', 'TR-0903', 'TR-0902', 'TR-0901']);
  ok(!('internal_notes' in g.orders[0]), 'order summaries are trimmed');
  eq(call(env, 'customers.get', { customer_id: 'C_nope' }, t3).error.code, 'NOT_FOUND');
});

/* ---------------- milestone 4: documents ---------------- */

const t4 = tok();
const std = () => {
  const pk = table('Packages').find(p => p.name === 'Standard');
  return { pk, lines: table('TemplateLines').filter(l => l.package_id === pk.package_id).map(l => ({ label: l.label, amount_cents: l.amount_cents, kind: l.kind })) };
};
const docPayload = (over) => {
  const s = std();
  return Object.assign({
    type: 'invoice', customer_id: custId, fulfillment: 'pickup',
    items: [{ product_id: s.pk.product_id, package_id: s.pk.package_id, title: 'Custom Bomber Jacket: Standard', qty: 1,
      details: { style: 'womens', spots: [{ key: 'back', patch_no: '30' }] }, lines: s.lines }]
  }, over || {});
};
// The earlier "Standard" test added a $5 line; put the seeded $275 lines back for these tests.
(() => {
  const s = std();
  const keep = s.lines.filter(l => l.label !== 'Test line' && l.label !== 'All in');
  call(env, 'catalog.saveTemplateLines', { package_id: s.pk.package_id, lines: keep }, t4);
})();

let inv;
test('docs.save creates an invoice with TR-1001, draft, awaiting payment, server totals (acceptance 1)', () => {
  const r = call(env, 'docs.save', docPayload(), t4);
  eq(r.ok, true, JSON.stringify(r.error)); inv = r.data;
  eq(inv.doc.number, 'TR-1001'); eq(inv.doc.status, 'draft'); eq(inv.doc.stage, 'awaiting_payment');
  eq(inv.doc.subtotal_cents, 27500); eq(inv.doc.total_cents, 27500); eq(inv.doc.upfront_percent, 100);
  ok(inv.doc.public_id.length >= 24, 'public id');
  eq(inv.items.length, 1); eq(inv.items[0].lines.length, 7); eq(inv.items[0].details.style, 'womens');
  eq(inv.customer.customer_id, custId);
  eq(inv.log.map(l => l.action), ['created']);
  eq(inv.doc.flags.not_sent, true); eq(inv.doc.amount_due_cents, 27500); eq(inv.doc.payment_status, 'unpaid');
});

test('totals ignore what the app claims: qty 2 = $550, discount applied, never below 0 (acceptance 8)', () => {
  const r = call(env, 'docs.save', docPayload({ doc_id: inv.doc.doc_id, subtotal_cents: 1, total_cents: 1,
    items: [Object.assign({}, inv.items[0], { qty: 2 })], discount_cents: 5000, discount_label: 'Friend' }), t4);
  eq(r.data.doc.subtotal_cents, 55000); eq(r.data.doc.total_cents, 50000); eq(r.data.doc.number, 'TR-1001', 'number kept');
  const r2 = call(env, 'docs.save', docPayload({ doc_id: inv.doc.doc_id, discount_cents: 999999 }), t4);
  eq(r2.data.doc.total_cents, 0);
});

test('editing keeps item and line ids the app sends, and replaces the old rows', () => {
  const cur = call(env, 'docs.get', { doc_id: inv.doc.doc_id }, t4).data;
  const item = cur.items[0];
  const lines = item.lines.slice(0, 6).concat([{ line_id: 'L_left_sleeve1', label: 'Left sleeve surcharge', amount_cents: 1000, kind: 'addon', addon_id: 'ADD_x' }]);
  const r = call(env, 'docs.save', docPayload({ doc_id: inv.doc.doc_id, items: [Object.assign({}, item, { lines })] }), t4);
  eq(r.data.items[0].item_id, item.item_id);
  eq(r.data.items[0].lines.map(l => l.line_id).slice(0, 6), item.lines.slice(0, 6).map(l => l.line_id));
  eq(r.data.items[0].lines[6].line_id, 'L_left_sleeve1');
  eq(table('DocLines').filter(l => l.doc_id === inv.doc.doc_id).length, 7);
  eq(table('DocItems').filter(l => l.doc_id === inv.doc.doc_id).length, 1);
  eq(r.data.doc.total_cents, 27800 + 1000); // the 6 base lines ($278) + left sleeve $10
});

test('bad ids from the app are replaced; duplicate ids are not reused', () => {
  const s = std();
  const r = call(env, 'docs.save', docPayload({ doc_id: inv.doc.doc_id, items: [
    { item_id: 'x', product_id: s.pk.product_id, package_id: s.pk.package_id, title: 'A', qty: 1, lines: [{ line_id: 'dup_1', label: 'a', amount_cents: 1, kind: 'custom' }] },
    { item_id: '<script>', product_id: s.pk.product_id, package_id: s.pk.package_id, title: 'B', qty: 1, lines: [{ line_id: 'dup_1', label: 'b', amount_cents: 2, kind: 'custom' }] }
  ] }), t4);
  const ids = r.data.items.map(i => i.item_id); ok(ids[0] !== 'x' && ids[1] !== '<script>');
  ok(r.data.items[1].lines[0].line_id !== 'dup_1', 'second duplicate replaced');
});

test('quote gets Q-1001; numbers increase and are never reused (5.7)', () => {
  const q1 = call(env, 'docs.save', docPayload({ type: 'quote' }), t4).data;
  eq(q1.doc.number, 'Q-1001'); eq(q1.doc.stage, '');
  const i2 = call(env, 'docs.save', docPayload(), t4).data; eq(i2.doc.number, 'TR-1002');
  const q2 = call(env, 'docs.save', docPayload({ type: 'quote' }), t4).data; eq(q2.doc.number, 'Q-1002');
  const s = vm.runInContext('getSettings_()', env.ctx); eq(s.next_quote_no, 1003); eq(s.next_order_no, 1003);
});

test('docs.save validation: customer, qty, amounts, kinds, upfront, date', () => {
  const bad = (over, code, msg) => { const r = call(env, 'docs.save', docPayload(over), t4); eq(r.ok, false); eq(r.error.code, code || 'VALIDATION'); if (msg) eq(r.error.message, msg); };
  bad({ customer_id: '' }, 'VALIDATION', 'Please choose a customer.');
  bad({ customer_id: 'C_nobody' }, 'VALIDATION', 'Please choose a customer.');
  bad({ type: 'receipt' });
  bad({ upfront_percent: 0 }); bad({ upfront_percent: 50.5 });
  bad({ est_ready_date: 'next week' });
  bad({ discount_cents: -100 });
  const s = std();
  bad({ items: [{ product_id: s.pk.product_id, package_id: s.pk.package_id, title: 'x', qty: 0, lines: [] }] }, 'VALIDATION', 'Item 1 quantity must be from 1 to 99.');
  bad({ items: [{ title: 'x', qty: 1, lines: [{ label: 'a', amount_cents: 1.5 }] }] }, 'VALIDATION', 'Item 1, line 1 amount must be an amount up to $100,000.');
  bad({ items: [{ title: 'x', qty: 1, lines: [{ label: 'a', amount_cents: 1, kind: 'magic' }] }] });
  bad({ items: [{ title: '', qty: 1, lines: [] }] }, 'VALIDATION', 'Item 1 title is required.');
  eq(call(env, 'docs.save', docPayload({ doc_id: 'D_nope' }), t4).error.code, 'NOT_FOUND');
});

test('upfront 50% of $341.01 is due now as $170.51, rounded up (acceptance 10)', () => {
  const r = call(env, 'docs.save', docPayload({ upfront_percent: 50, items: [{ title: 'x', qty: 1, lines: [{ label: 'a', amount_cents: 34101, kind: 'custom' }] }] }), t4);
  eq(r.data.doc.total_cents, 34101); eq(r.data.doc.amount_due_cents, 17051);
});

test('docs.get by number; void and converted documents cannot be edited', () => {
  eq(call(env, 'docs.get', { number: 'tr-1001' }, t4).data.doc.doc_id, inv.doc.doc_id);
  eq(call(env, 'docs.get', { number: 'TR-9999' }, t4).error.code, 'NOT_FOUND');
  const d = table('Documents').find(x => x.number === 'TR-1002');
  d.status = 'void'; vm.runInContext('updateRow_', env.ctx)('Documents', d);
  eq(call(env, 'docs.save', docPayload({ doc_id: d.doc_id }), t4).error.message, 'This order is void and can\'t be changed.');
});

test('docs.list: filters, search by number/name/phone, newest first, no notes', () => {
  const all = call(env, 'docs.list', {}, t4).data;
  ok(all.total >= 6); ok(!('internal_notes' in all.rows[0]));
  const quotes = call(env, 'docs.list', { filter: 'quotes' }, t4).data.rows; ok(quotes.length >= 2 && quotes.every(r => r.type === 'quote'));
  const unpaid = call(env, 'docs.list', { filter: 'unpaid' }, t4).data.rows; ok(unpaid.every(r => r.type === 'invoice' && r.status !== 'void'));
  eq(call(env, 'docs.list', { q: 'tr-1001' }, t4).data.rows.filter(r => r.number === 'TR-1001').length, 1);
  ok(call(env, 'docs.list', { q: 'gloria' }, t4).data.total >= 1);
  ok(call(env, 'docs.list', { q: '555-0142' }, t4).data.total >= 1);
  eq(call(env, 'docs.list', { q: 'zzzz' }, t4).data.total, 0);
  const page = call(env, 'docs.list', { limit: 2, offset: 0 }, t4).data; eq(page.rows.length, 2);
});

test('flags: overdue after 7 days unpaid, ready 3+ days, expired quote, expiring soon (acceptance 12, 13, 17)', () => {
  const flags = vm.runInContext('docFlags_', env.ctx);
  const st = vm.runInContext('effectiveStatus_', env.ctx);
  const settings = { unpaid_flag_days: 7, ready_flag_days: 3 };
  const now = Date.now(), day = 86400000, iso = (ms) => new Date(ms).toISOString();
  const base = { type: 'invoice', status: 'issued', stage: 'awaiting_payment', total_cents: 34100, paid_cents: 0, upfront_percent: 100 };
  eq(flags(Object.assign({}, base, { sent_at: iso(now - 8 * day) }), 1, settings, now).overdue, true);
  eq(flags(Object.assign({}, base, { sent_at: iso(now - 6 * day) }), 1, settings, now).overdue, false);
  eq(flags(Object.assign({}, base, { sent_at: iso(now - 8 * day), paid_cents: 34100 }), 1, settings, now).overdue, false);
  const ready = flags(Object.assign({}, base, { stage: 'ready', paid_cents: 34100, ready_at: iso(now - 4 * day) }), 1, settings, now);
  eq(ready.ready_late, true); eq(ready.balance_overdue, false);
  eq(flags(Object.assign({}, base, { stage: 'ready', ready_at: iso(now - 2 * day) }), 1, settings, now).ready_late, false);
  const q = { type: 'quote', status: 'sent', total_cents: 1, sent_at: iso(now - 31 * day), expires_at: iso(now - day) };
  eq(st(q, now), 'expired'); eq(flags(q, 1, settings, now).quote_waiting, false);
  const q2 = Object.assign({}, q, { expires_at: iso(now + 3 * day) });
  eq(flags(q2, 1, settings, now).quote_waiting, true); eq(flags(q2, 1, settings, now).quote_expiring, true);
  eq(flags({ type: 'invoice', status: 'draft', total_cents: 0 }, 0, settings, now).not_sent, false, 'empty draft is not "not sent"');
});

/* ---------------- milestone 5: customer page ---------------- */

const t5 = tok();
const pub = (action, payload, token) => call(env, action, payload, token);
let inv5;
test('drafts, bad ids and void documents show "no longer active" and leak nothing (acceptance 18)', () => {
  inv5 = call(env, 'docs.save', docPayload({ internal_notes: 'SECRET-NOTE-123', customer_note: 'See you soon' }), t5).data;
  const r = pub('public.getDocument', { public_id: inv5.doc.public_id });
  eq(r.error.code, 'NOT_FOUND');
  eq(r.error.message, 'This link is no longer active. Please contact Terri Renee Evolvé at 623-521-6235.');
  eq(Object.keys(r).sort(), ['error', 'ok']);
  eq(pub('public.getDocument', { public_id: 'short' }).error.code, 'NOT_FOUND');
  eq(pub('public.getDocument', { public_id: 'x'.repeat(43) }).error.code, 'NOT_FOUND');
  eq(pub('public.getDocument', { public_id: '<script>alert(1)</script>aaaaaaaaaaaaaaaaaaaa' }).error.code, 'NOT_FOUND');
  eq(pub('public.getDocument', {}).error.code, 'NOT_FOUND');
});

test('Terri can preview a draft with her token, without counting a view', () => {
  const r = pub('public.getDocument', { public_id: inv5.doc.public_id }, t5);
  eq(r.ok, true); eq(r.data.doc.status, 'draft');
  eq(table('Documents').find(d => d.doc_id === inv5.doc.doc_id).view_count, 0);
});

test('mark sent: invoice becomes issued; empty orders cannot be sent', () => {
  const r = call(env, 'docs.markSent', { doc_id: inv5.doc.doc_id, method: 'manual' }, t5);
  eq(r.data.doc.status, 'issued'); ok(r.data.doc.sent_at); eq(r.data.doc.sent_method, 'manual');
  eq(r.data.doc.flags.not_sent, false);
  ok(r.data.log.some(l => l.action === 'sent'));
  const empty = call(env, 'docs.save', docPayload({ items: [] }), t5).data;
  eq(call(env, 'docs.markSent', { doc_id: empty.doc.doc_id }, t5).error.message, 'Add at least one item before sending.');
});

test('customer page response contains only customer-safe fields (acceptance 20)', () => {
  const r = pub('public.getDocument', { public_id: inv5.doc.public_id });
  eq(r.ok, true);
  const json = JSON.stringify(r.data);
  ['SECRET-NOTE-123', '602-555-0142', 'gloria@example.com', inv5.doc.doc_id, custId, 'internal_notes', '"photos"', 'photo_id', 'photo_file_id', 'drive_file_id', 'token', 'Size L']
    .forEach(s => ok(json.indexOf(s) === -1, 'leaked: ' + s));
  eq(Object.keys(r.data).sort(), ['business', 'customer', 'doc', 'items', 'payments']);
  eq(Object.keys(r.data.customer), ['name']);
  eq(r.data.doc.customer_note, 'See you soon');
  eq(r.data.business.zelle_contact, '623-523-7472'); eq(r.data.business.zelle_display_name, 'THERESA ODOM');
  eq(r.data.business.terms.length, 8);
  eq(r.data.doc.amount_due_cents, 27500); eq(r.data.doc.payment_status, 'unpaid');
  eq(r.data.items[0].lines.length, 7); eq(Object.keys(r.data.items[0].lines[0]).sort(), ['amount_cents', 'label']);
  eq(r.data.items[0].details.style, "Women's");
  eq(r.data.items[0].details.spots, [{ label: 'Back', patch_no: '30', patch_name: 'OES chenille letters', own_patch: false, notes: '' }]);
});

test('views are counted for customers only (acceptance 15)', () => {
  const row = () => table('Documents').find(d => d.doc_id === inv5.doc.doc_id);
  eq(row().view_count, 1); ok(row().first_viewed_at);
  const first = row().first_viewed_at;
  pub('public.getDocument', { public_id: inv5.doc.public_id });
  eq(row().view_count, 2); eq(row().first_viewed_at, first);
  pub('public.getDocument', { public_id: inv5.doc.public_id }, t5);
  pub('public.getDocument', { public_id: inv5.doc.public_id, preview: true });
  eq(row().view_count, 2, 'admin token and preview=1 do not count');
  eq(table('Log').filter(l => l.doc_id === inv5.doc.doc_id && l.action === 'viewed').length, 1, 'first view logged once');
  eq(call(env, 'docs.get', { doc_id: inv5.doc.doc_id }, t5).data.doc.flags.viewed, true);
});

let q5;
test('approving needs the terms box and a name; quote must be sent', () => {
  const s = std();
  q5 = call(env, 'docs.save', docPayload({ type: 'quote', internal_notes: 'quote secret', items: [{
    item_id: 'I_quoteitem1', product_id: s.pk.product_id, package_id: s.pk.package_id, title: 'Jacket', qty: 1,
    details: { style: 'mens', spots: [{ key: 'back', patch_no: '01' }, { key: 'extra_zz', where: 'collar', line_id: 'L_extra_line1', patch_no: '02' }] },
    lines: s.lines.concat([{ line_id: 'L_extra_line1', label: 'Extra small patch', amount_cents: 2800, kind: 'addon' }]) }] }), t5).data;
  eq(pub('public.approveQuote', { public_id: q5.doc.public_id, name: 'Gloria Hayes', terms_accepted: true }).error.code, 'NOT_FOUND', 'draft quote');
  const sent = call(env, 'docs.markSent', { doc_id: q5.doc.doc_id }, t5).data.doc;
  eq(sent.status, 'sent');
  const days = (new Date(sent.expires_at) - new Date(sent.sent_at)) / 86400000; ok(days > 29.9 && days < 30.1, 'expires in 30 days');
  eq(pub('public.approveQuote', { public_id: q5.doc.public_id, name: 'Gloria Hayes' }).error.message, 'Please tick the box to agree to the terms.');
  eq(pub('public.approveQuote', { public_id: q5.doc.public_id, name: ' ', terms_accepted: true }).error.message, 'Your full name is required.');
  eq(pub('public.approveQuote', { public_id: q5.doc.public_id, name: 'G', terms_accepted: 'yes' }).error.code, 'VALIDATION');
});

test('approval converts the quote to a new sent invoice shown in place (acceptance 16)', () => {
  const before = vm.runInContext('getSettings_()', env.ctx).next_order_no;
  const r = pub('public.approveQuote', { public_id: q5.doc.public_id, name: 'Gloria Hayes', terms_accepted: true });
  eq(r.ok, true, JSON.stringify(r.error));
  const d = r.data.doc;
  eq(d.type, 'invoice'); eq(d.number, 'TR-' + before); eq(d.status, 'issued'); eq(d.stage, 'awaiting_payment');
  eq(d.from_quote_number, q5.doc.number); eq(d.total_cents, 27500 + 2800); eq(d.amount_due_cents, 30300);
  ok(d.public_id !== q5.doc.public_id);
  ok(JSON.stringify(r.data).indexOf('quote secret') === -1, 'no internal notes');
  const quoteRow = table('Documents').find(x => x.doc_id === q5.doc.doc_id);
  eq(quoteRow.status, 'converted'); eq(quoteRow.approved_name, 'Gloria Hayes'); eq(quoteRow.terms_accepted, true); ok(quoteRow.approved_at);
  const invRow = table('Documents').find(x => x.number === d.number);
  eq(invRow.sent_method, 'customer_approved'); ok(invRow.sent_at); eq(invRow.from_quote_id, q5.doc.doc_id); eq(invRow.internal_notes, 'quote secret');
  eq(quoteRow.converted_invoice_id, invRow.doc_id);
  // copied items get new ids, and the extra spot points at the copied price line
  const full = call(env, 'docs.get', { doc_id: invRow.doc_id }, t5).data;
  ok(full.items[0].item_id !== 'I_quoteitem1');
  const spot = full.items[0].details.spots.find(s => s.key === 'extra_zz');
  const line = full.items[0].lines.find(l => l.label === 'Extra small patch');
  eq(spot.line_id, line.line_id); ok(line.line_id !== 'L_extra_line1');
  // the customer's extra spot shows with its place
  eq(r.data.items[0].details.spots.map(s => s.label), ['Back', 'Extra A (collar)']);
  // logs
  eq(table('Log').filter(l => l.doc_id === q5.doc.doc_id).map(l => l.action), ['created', 'sent', 'approved', 'converted']);
});

test('old quote link now opens the invoice; approving twice is refused', () => {
  const r = pub('public.getDocument', { public_id: q5.doc.public_id });
  eq(r.data.doc.type, 'invoice'); eq(r.data.doc.from_quote_number, q5.doc.number);
  eq(pub('public.approveQuote', { public_id: q5.doc.public_id, name: 'Gloria Hayes', terms_accepted: true }).error.message, 'This quote can no longer be approved.');
  eq(call(env, 'docs.save', docPayload({ doc_id: q5.doc.doc_id, type: 'quote' }), t5).error.message, 'This quote became an invoice. Edit the invoice instead.');
});

test('expired quote: shown as expired, cannot be approved (acceptance 17)', () => {
  const q = call(env, 'docs.save', docPayload({ type: 'quote' }), t5).data;
  call(env, 'docs.markSent', { doc_id: q.doc.doc_id }, t5);
  const row = table('Documents').find(d => d.doc_id === q.doc.doc_id);
  row.expires_at = '2026-01-01T00:00:00-07:00'; vm.runInContext('updateRow_', env.ctx)('Documents', row);
  eq(pub('public.getDocument', { public_id: q.doc.public_id }).data.doc.status, 'expired');
  eq(pub('public.approveQuote', { public_id: q.doc.public_id, name: 'A B', terms_accepted: true }).error.message, 'This quote has expired. Contact us to renew it.');
  eq(pub('public.declineQuote', { public_id: q.doc.public_id }).error.code, 'VALIDATION');
});

test('decline with a note; then neither approve nor decline again', () => {
  const q = call(env, 'docs.save', docPayload({ type: 'quote' }), t5).data;
  call(env, 'docs.markSent', { doc_id: q.doc.doc_id }, t5);
  const r = pub('public.declineQuote', { public_id: q.doc.public_id, note: 'Too much for now, maybe in spring' });
  eq(r.data.doc.status, 'declined');
  const row = table('Documents').find(d => d.doc_id === q.doc.doc_id);
  eq(row.decline_note, 'Too much for now, maybe in spring'); ok(row.declined_at);
  eq(pub('public.declineQuote', { public_id: q.doc.public_id }).error.code, 'VALIDATION');
  eq(pub('public.approveQuote', { public_id: q.doc.public_id, name: 'A', terms_accepted: true }).error.message, 'This quote can no longer be approved.');
  ok(table('Log').some(l => l.doc_id === q.doc.doc_id && l.action === 'declined'));
});

test('void document link stops working', () => {
  const row = table('Documents').find(d => d.doc_id === inv5.doc.doc_id);
  row.status = 'void'; vm.runInContext('updateRow_', env.ctx)('Documents', row);
  eq(pub('public.getDocument', { public_id: inv5.doc.public_id }).error.code, 'NOT_FOUND');
  eq(pub('public.getDocument', { public_id: inv5.doc.public_id }, t5).error.code, 'NOT_FOUND', 'even for Terri');
});

/* ---------------- milestone 6: sending, payments, progress ---------------- */

const t6 = tok();
const lookbook = () => {
  const s = std();
  const ls = table('AddOns').find(a => a.rule === 'left_sleeve');
  return docPayload({ items: [{ item_id: 'I_jacket0001', product_id: s.pk.product_id, package_id: s.pk.package_id, title: 'Jacket', qty: 1,
    details: { spots: [{ key: 'sleeve', side: 'left' }] },
    lines: s.lines.concat([{ label: 'Left sleeve', amount_cents: 1000, kind: 'addon', addon_id: ls.addon_id },
      { label: 'Extra small', amount_cents: 2800, kind: 'addon' }, { label: 'Extra small', amount_cents: 2800, kind: 'addon' }]) }] });
};
let inv6;
test('acceptance 14: no "Did you send it?" yes means still Not sent', () => {
  inv6 = call(env, 'docs.save', lookbook(), t6).data;
  eq(inv6.doc.total_cents, 34100);
  eq(call(env, 'docs.get', { doc_id: inv6.doc.doc_id }, t6).data.doc.flags.not_sent, true);
  eq(inv6.progress.length, 1); eq(inv6.progress[0].steps.length, 8); eq(inv6.progress[0].final_step, 7);
  eq(inv6.progress[0].steps.map(s => s.done_at).filter(Boolean).length, 0);
});

test('acceptance 11: $341 Zelle payment = Paid in full, In progress, step 1 checked', () => {
  call(env, 'docs.markSent', { doc_id: inv6.doc.doc_id, method: 'share' }, t6);
  const r = call(env, 'payments.add', { doc_id: inv6.doc.doc_id, amount_cents: 34100, method: 'zelle', paid_on: '2026-11-22', note: 'memo TR' }, t6);
  eq(r.ok, true, JSON.stringify(r.error));
  const d = r.data.doc;
  eq(d.paid_cents, 34100); eq(d.payment_status, 'paid'); eq(d.stage, 'in_progress'); eq(d.amount_due_cents, 0);
  ok(r.data.progress[0].steps[0].done_at, 'step 1 ticked'); eq(r.data.progress[0].steps[1].done_at, '');
  eq(r.data.payments.length, 1); eq(r.data.payments[0].method, 'zelle');
  eq(r.data.log.slice(0, 2).map(l => l.action), ['stage', 'payment'], 'newest first');
  const pubv = call(env, 'public.getDocument', { public_id: inv6.doc.public_id, preview: true }).data;
  eq(pubv.payments, [{ paid_on: '2026-11-22', amount_cents: 34100, method: 'zelle' }]);
});

test('payment validation: amount, method, date, quotes, cancelled', () => {
  const id = inv6.doc.doc_id;
  eq(call(env, 'payments.add', { doc_id: id, amount_cents: 0, method: 'cash' }, t6).error.message, 'The amount must be more than $0.');
  eq(call(env, 'payments.add', { doc_id: id, amount_cents: 100, method: 'card' }, t6).error.code, 'VALIDATION');
  eq(call(env, 'payments.add', { doc_id: id, amount_cents: 100, method: 'cash', paid_on: 'Tuesday' }, t6).error.code, 'VALIDATION');
  const q = call(env, 'docs.save', docPayload({ type: 'quote' }), t6).data;
  eq(call(env, 'payments.add', { doc_id: q.doc.doc_id, amount_cents: 100, method: 'cash' }, t6).error.message, 'This only works on invoices.');
});

test('partial upfront: under the deposit stays awaiting; reaching it moves to in progress; draft becomes issued', () => {
  const half = call(env, 'docs.save', docPayload({ upfront_percent: 50, items: [{ title: 'Purse', qty: 1, lines: [{ label: 'Purse', amount_cents: 34101, kind: 'custom' }] }] }), t6).data;
  const a = call(env, 'payments.add', { doc_id: half.doc.doc_id, amount_cents: 10000, method: 'cash' }, t6).data.doc;
  eq(a.stage, 'awaiting_payment'); eq(a.status, 'issued'); eq(a.amount_due_cents, 7051); eq(a.payment_status, 'partial');
  const b = call(env, 'payments.add', { doc_id: half.doc.doc_id, amount_cents: 7051, method: 'zelle' }, t6).data;
  eq(b.doc.stage, 'in_progress'); eq(b.doc.amount_due_cents, 0, 'balance not due until ready');
  ok(b.progress[0].steps[0].done_at);
  const r = call(env, 'docs.setStage', { doc_id: half.doc.doc_id, stage: 'ready' }, t6).data;
  eq(r.doc.amount_due_cents, 17050, 'balance due when ready'); ok(r.doc.ready_at);
});

test('void a payment: paid goes back down, stage stays, kept for the record', () => {
  const r0 = call(env, 'payments.add', { doc_id: inv6.doc.doc_id, amount_cents: 500, method: 'cash' }, t6).data;
  const extra = r0.payments.find(p => p.amount_cents === 500);
  eq(r0.doc.paid_cents, 34600);
  const r = call(env, 'payments.void', { payment_id: extra.payment_id, reason: 'typed by mistake' }, t6).data;
  eq(r.doc.paid_cents, 34100); eq(r.doc.stage, 'in_progress');
  ok(r.payments.find(p => p.payment_id === extra.payment_id).voided);
  eq(call(env, 'payments.void', { payment_id: extra.payment_id }, t6).error.message, 'That payment is already void.');
  ok(r.log.some(l => l.action === 'payment_void'));
});

test('checklist: tick, untick, keeps first date; bad step or item refused', () => {
  const id = inv6.doc.doc_id, item = inv6.progress[0].item_id;
  const a = call(env, 'checklist.toggle', { doc_id: id, item_id: item, step_no: 3, done: true }, t6).data;
  const first = a.progress[0].steps[2].done_at; ok(first);
  const b = call(env, 'checklist.toggle', { doc_id: id, item_id: item, step_no: 3, done: true }, t6).data;
  eq(b.progress[0].steps[2].done_at, first, 'first date kept');
  const c = call(env, 'checklist.toggle', { doc_id: id, item_id: item, step_no: 3, done: false }, t6).data;
  eq(c.progress[0].steps[2].done_at, '');
  eq(call(env, 'checklist.toggle', { doc_id: id, item_id: item, step_no: 0 }, t6).error.code, 'VALIDATION');
  eq(call(env, 'checklist.toggle', { doc_id: id, item_id: 'I_notonorder1', step_no: 2 }, t6).error.code, 'NOT_FOUND');
  // editing the order keeps ticked steps (item id kept)
  const cur = call(env, 'docs.get', { doc_id: id }, t6).data;
  const saved = call(env, 'docs.save', docPayload({ doc_id: id, items: cur.items.map(it => Object.assign({}, it)) }), t6).data;
  ok(saved.progress[0].steps[0].done_at, 'step 1 survives an edit');
});

test('stages: ready sets ready_at, Ready 3+ days flag (acceptance 13), completed, cancel needs a reason', () => {
  const id = inv6.doc.doc_id;
  const r = call(env, 'docs.setStage', { doc_id: id, stage: 'ready' }, t6).data;
  eq(r.doc.stage, 'ready'); ok(r.doc.ready_at); eq(r.doc.flags.ready_late, false);
  const row = table('Documents').find(d => d.doc_id === id);
  row.ready_at = new Date(Date.now() - 4 * 86400000).toISOString(); vm.runInContext('updateRow_', env.ctx)('Documents', row);
  const listed = call(env, 'docs.list', { filter: 'ready' }, t6).data.rows.find(x => x.doc_id === id);
  eq(listed.flags.ready_late, true); eq(listed.flags.balance_overdue, false);
  const done = call(env, 'docs.setStage', { doc_id: id, stage: 'completed' }, t6).data.doc;
  eq(done.stage, 'completed'); ok(done.completed_at);
  eq(call(env, 'docs.setStage', { doc_id: id, stage: 'cancelled' }, t6).error.message, 'Reason is required.');
  eq(call(env, 'docs.setStage', { doc_id: id, stage: 'shipped' }, t6).error.code, 'VALIDATION');
  const back = call(env, 'docs.setStage', { doc_id: id, stage: 'in_progress' }, t6).data.doc;
  eq(back.stage, 'in_progress', 'can move back');
  ok(table('Log').filter(l => l.doc_id === id && l.action === 'stage').length >= 3);
});

test('acceptance 12: sent 8 days ago and unpaid shows Overdue in the list', () => {
  const d = call(env, 'docs.save', docPayload(), t6).data;
  call(env, 'docs.markSent', { doc_id: d.doc.doc_id }, t6);
  const row = table('Documents').find(x => x.doc_id === d.doc.doc_id);
  row.sent_at = new Date(Date.now() - 8 * 86400000).toISOString(); vm.runInContext('updateRow_', env.ctx)('Documents', row);
  eq(call(env, 'docs.list', { filter: 'unpaid' }, t6).data.rows.find(x => x.doc_id === d.doc.doc_id).flags.overdue, true);
});

test('void needs a reason; void orders cannot be edited, paid or moved', () => {
  const d = call(env, 'docs.save', docPayload(), t6).data;
  eq(call(env, 'docs.void', { doc_id: d.doc.doc_id }, t6).error.message, 'Reason is required.');
  const v = call(env, 'docs.void', { doc_id: d.doc.doc_id, reason: 'Duplicate order' }, t6).data.doc;
  eq(v.status, 'void'); eq(v.void_reason, 'Duplicate order');
  eq(call(env, 'payments.add', { doc_id: d.doc.doc_id, amount_cents: 100, method: 'cash' }, t6).error.message, 'This order is void.');
  eq(call(env, 'docs.setStage', { doc_id: d.doc.doc_id, stage: 'ready' }, t6).error.message, 'This order is void.');
  eq(call(env, 'docs.save', docPayload({ doc_id: d.doc.doc_id }), t6).error.code, 'VALIDATION');
});

test('convert to invoice, mark approved, renew and duplicate', () => {
  const q = call(env, 'docs.save', docPayload({ type: 'quote', internal_notes: 'keep me' }), t6).data;
  const inv = call(env, 'docs.convertToInvoice', { doc_id: q.doc.doc_id }, t6).data;
  eq(inv.doc.type, 'invoice'); eq(inv.doc.status, 'draft'); eq(inv.doc.sent_at, ''); eq(inv.doc.from_quote_number, q.doc.number);
  eq(inv.doc.internal_notes, 'keep me'); eq(inv.doc.total_cents, q.doc.total_cents);
  eq(call(env, 'docs.get', { doc_id: q.doc.doc_id }, t6).data.doc.converted_invoice_number, inv.doc.number);
  eq(call(env, 'docs.convertToInvoice', { doc_id: q.doc.doc_id }, t6).error.message, 'This quote is already an invoice.');
  eq(call(env, 'docs.void', { doc_id: q.doc.doc_id, reason: 'x' }, t6).error.message, 'This quote became an invoice. Void the invoice instead.');

  const q2 = call(env, 'docs.save', docPayload({ type: 'quote' }), t6).data;
  call(env, 'docs.markSent', { doc_id: q2.doc.doc_id }, t6);
  const inv2 = call(env, 'docs.markApproved', { doc_id: q2.doc.doc_id }, t6).data;
  eq(inv2.doc.type, 'invoice'); eq(inv2.doc.status, 'draft');
  const q2row = table('Documents').find(x => x.doc_id === q2.doc.doc_id);
  eq(q2row.status, 'converted'); ok(q2row.approved_at);

  const q3 = call(env, 'docs.save', docPayload({ type: 'quote' }), t6).data;
  call(env, 'docs.markSent', { doc_id: q3.doc.doc_id }, t6);
  const row = table('Documents').find(x => x.doc_id === q3.doc.doc_id);
  row.expires_at = '2026-01-01T00:00:00-07:00'; vm.runInContext('updateRow_', env.ctx)('Documents', row);
  eq(call(env, 'docs.get', { doc_id: q3.doc.doc_id }, t6).data.doc.effective_status, 'expired');
  const renewed = call(env, 'docs.renewQuote', { doc_id: q3.doc.doc_id }, t6).data.doc;
  eq(renewed.effective_status, 'sent'); ok(new Date(renewed.expires_at) > Date.now() + 29 * 86400000);
  eq(call(env, 'docs.renewQuote', { doc_id: q.doc.doc_id }, t6).error.code, 'VALIDATION', 'converted quote');

  const dup = call(env, 'docs.duplicate', { doc_id: inv6.doc.doc_id }, t6).data;
  eq(dup.doc.type, 'invoice'); eq(dup.doc.status, 'draft'); eq(dup.doc.paid_cents, 0); eq(dup.doc.total_cents, 34100);
  ok(dup.doc.number !== inv6.doc.number); ok(dup.items[0].item_id !== inv6.items[0].item_id);
  eq(dup.payments.length, 0); eq(dup.progress[0].steps.filter(s => s.done_at).length, 0);
});

/* ---------------- milestone 7: dashboard, emails, photos, settings ---------------- */

const t7 = tok();
test('bootstrap remembers the app address for email links (valid URLs only)', () => {
  call(env, 'bootstrap', { app_url: 'javascript:alert(1)//' }, t7);
  ok(!env.props.APP_URL, 'bad url ignored');
  call(env, 'bootstrap', { app_url: 'https://terrireneedesigns.github.io/tr-orders/' }, t7);
  eq(env.props.APP_URL, 'https://terrireneedesigns.github.io/tr-orders/');
  eq(call(env, 'dashboard.get', {}).error.code, 'AUTH');
});

test('approval emails the business inbox with total, new invoice and a link (acceptance 16)', () => {
  env.mail.length = 0;
  const q = call(env, 'docs.save', docPayload({ type: 'quote' }), t7).data;
  call(env, 'docs.markSent', { doc_id: q.doc.doc_id }, t7);
  const r = call(env, 'public.approveQuote', { public_id: q.doc.public_id, name: 'Gloria Hayes', terms_accepted: true });
  eq(r.ok, true);
  eq(env.mail.length, 1);
  const m = env.mail[0];
  eq(m.to, 'terrireneedesigns@gmail.com'); eq(m.subject, '✅ ' + q.doc.number + ' approved by Gloria Hayes');
  ok(m.body.indexOf('Total: $275.00') !== -1, m.body);
  ok(m.body.indexOf('New invoice: ' + r.data.doc.number) !== -1);
  ok(m.body.indexOf('https://terrireneedesigns.github.io/tr-orders/index.html#/orders/' + r.data.doc.number) !== -1);
});

test('if email is not allowed yet, approving and declining still work', () => {
  env.setMailWorks(false); env.mail.length = 0;
  const q = call(env, 'docs.save', docPayload({ type: 'quote' }), t7).data;
  call(env, 'docs.markSent', { doc_id: q.doc.doc_id }, t7);
  eq(call(env, 'public.approveQuote', { public_id: q.doc.public_id, name: 'A B', terms_accepted: true }).ok, true);
  const q2 = call(env, 'docs.save', docPayload({ type: 'quote' }), t7).data;
  call(env, 'docs.markSent', { doc_id: q2.doc.doc_id }, t7);
  eq(call(env, 'public.declineQuote', { public_id: q2.doc.public_id }).ok, true);
  eq(env.mail.length, 0);
  env.setMailWorks(true);
});

test('decline email includes the note', () => {
  env.mail.length = 0;
  const q = call(env, 'docs.save', docPayload({ type: 'quote' }), t7).data;
  call(env, 'docs.markSent', { doc_id: q.doc.doc_id }, t7);
  call(env, 'public.declineQuote', { public_id: q.doc.public_id, note: 'Maybe next year' });
  eq(env.mail[0].subject, q.doc.number + ' declined'); ok(env.mail[0].body.indexOf('"Maybe next year"') !== -1);
});

test('dashboard: needs-attention lists and snapshot numbers (SPEC 6.2)', () => {
  const d = call(env, 'dashboard.get', {}, t7).data;
  ['not_sent', 'overdue', 'ready_late', 'quotes_expiring', 'quotes_waiting'].forEach(k => ok(Array.isArray(d.needs[k]), k));
  ok(d.needs.not_sent.length > 0, 'drafts with items are not sent');
  ok(d.needs.overdue.some(r => r.amount_due_cents > 0), 'the 8-days-ago invoice is overdue');
  ok(!('internal_notes' in (d.needs.not_sent[0] || {})));
  // snapshot is computed from documents and payments
  const docs = table('Documents'), pays = table('Payments');
  const unpaid = docs.filter(x => x.type === 'invoice' && x.status === 'issued' && x.stage !== 'cancelled')
    .reduce((t, x) => t + vm.runInContext('amountDueNow_', env.ctx)(x), 0);
  eq(d.snapshot.unpaid_total_cents, unpaid);
  eq(d.snapshot.in_progress, docs.filter(x => x.type === 'invoice' && x.status === 'issued' && x.stage === 'in_progress').length);
  const month = d.month; const live = new Set(docs.filter(x => x.status !== 'void').map(x => x.doc_id));
  eq(d.snapshot.collected_month_cents, pays.filter(p => !p.voided && live.has(p.doc_id) && p.paid_on.slice(0, 7) === month).reduce((t, p) => t + p.amount_cents, 0));
  eq(d.snapshot.ready, docs.filter(x => x.type === 'invoice' && x.status === 'issued' && x.stage === 'ready').length);
});

test('daily digest: off by default; when on, emails overdue and ready 3+ days only if there is any', () => {
  env.mail.length = 0;
  eq(env.ctx.dailyDigest(), 'off');
  eq(call(env, 'settings.save', { values: { daily_digest: 'on' } }, t7).data.daily_digest, 'on');
  eq(env.ctx.dailyDigest(), 'sent');
  ok(/need attention$/.test(env.mail[0].subject)); ok(env.mail[0].body.indexOf('Unpaid, overdue') !== -1);
  call(env, 'settings.save', { values: { daily_digest: 'off' } }, t7);
});

test('setupNotifications schedules the 8 AM digest once', () => {
  env.ctx.setupNotifications(); env.ctx.setupNotifications();
  const t = env.triggers.filter(x => x.fn === 'dailyDigest'); eq(t.length, 1); eq(t[0].hour, 8);
  eq(env.triggers.filter(x => x.fn === 'nightlyBackup').length, 1, 'backup trigger untouched');
});

test('settings.save: validates, refuses numbering and unknown keys, saves terms', () => {
  eq(call(env, 'settings.save', { values: { next_order_no: '1' } }, t7).error.message, 'That setting can\'t be changed here.');
  eq(call(env, 'settings.save', { values: { unpaid_flag_days: 0 } }, t7).error.code, 'VALIDATION');
  eq(call(env, 'settings.save', { values: { notify_email: 'nope' } }, t7).error.code, 'VALIDATION');
  eq(call(env, 'settings.save', { values: { business_name: '' } }, t7).error.message, 'Business name is required.');
  const s = call(env, 'settings.save', { values: { unpaid_flag_days: 10, terms: [{ title: 'Payment', text: 'Due at order.' }] } }, t7).data;
  eq(s.unpaid_flag_days, 10); eq(s.terms, [{ title: 'Payment', text: 'Due at order.' }]);
  call(env, 'settings.save', { values: { unpaid_flag_days: 7, terms: vm.runInContext('SEED_TERMS', env.ctx) } }, t7);
  eq(vm.runInContext('getSettings_()', env.ctx).terms.length, 8);
});

const tinyJpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
let photoDoc, photoId;
test('photos: upload to the order folder, list, get full and thumbnail, delete', () => {
  photoDoc = call(env, 'docs.save', docPayload(), t7).data;
  const r = call(env, 'photos.upload', { doc_id: photoDoc.doc.doc_id, data: 'data:image/jpeg;base64,' + tinyJpeg, caption: 'Back patch layout' }, t7);
  eq(r.ok, true, JSON.stringify(r.error)); eq(r.data.photos.length, 1); photoId = r.data.photos[0].photo_id;
  eq(r.data.photos[0].caption, 'Back patch layout');
  const orderFolder = env.root.children.find(c => c.name === 'TR Orders').children.find(c => c.name === 'Order Photos').children.find(c => c.name === photoDoc.doc.number);
  ok(orderFolder, 'folder named after the order number'); eq(orderFolder.children.length, 1);
  const full = call(env, 'photos.get', { photo_id: photoId }, t7).data;
  eq(full.mime, 'image/jpeg'); eq(full.data, tinyJpeg);
  eq(call(env, 'photos.get', { photo_id: photoId, thumb: true }, t7).data.mime, 'image/png');
  env.setThumbsWork(false);
  eq(call(env, 'photos.get', { photo_id: photoId, thumb: true }, t7).data.mime, 'image/jpeg', 'no thumbnail yet: full image');
  env.setThumbsWork(true);
  eq(call(env, 'docs.get', { doc_id: photoDoc.doc.doc_id }, t7).data.photos.length, 1);
  const del = call(env, 'photos.delete', { photo_id: photoId }, t7).data;
  eq(del.photos.length, 0); ok(orderFolder.children[0].trashed, 'file in Drive trash');
  eq(call(env, 'photos.delete', { photo_id: photoId }, t7).error.code, 'NOT_FOUND');
});

test('photos: refuse non-images, oversize data, void orders; never on the customer page', () => {
  eq(call(env, 'photos.upload', { doc_id: photoDoc.doc.doc_id, data: 'data:text/html;base64,PGh0bWw+' }, t7).error.code, 'VALIDATION');
  eq(call(env, 'photos.upload', { doc_id: photoDoc.doc.doc_id, data: 'not base64 !!' }, t7).error.code, 'VALIDATION');
  call(env, 'photos.upload', { doc_id: photoDoc.doc.doc_id, data: tinyJpeg }, t7);
  call(env, 'docs.markSent', { doc_id: photoDoc.doc.doc_id }, t7);
  const pubv = JSON.stringify(call(env, 'public.getDocument', { public_id: photoDoc.doc.public_id, preview: true }).data);
  ok(pubv.indexOf('drive_file_id') === -1 && pubv.indexOf('photo_id') === -1 && pubv.indexOf(tinyJpeg.slice(0, 20)) === -1);
  eq(call(env, 'photos.get', { photo_id: 'PH_nope' }, t7).error.code, 'NOT_FOUND');
});

test('patch photo: upload replaces the old one and shows on the catalog', () => {
  const a = call(env, 'photos.upload', { patch_no: '30', data: tinyJpeg }, t7).data;
  const p30 = a.catalog.patches.find(p => p.patch_no === '30'); ok(p30.photo_file_id);
  const first = p30.photo_file_id;
  const b = call(env, 'photos.upload', { patch_no: '30', data: tinyJpeg }, t7).data;
  ok(b.catalog.patches.find(p => p.patch_no === '30').photo_file_id !== first);
  ok(env.files[first].trashed, 'old patch photo trashed');
  eq(call(env, 'photos.get', { patch_no: '30' }, t7).data.data, tinyJpeg);
  eq(call(env, 'photos.upload', { patch_no: '999', data: tinyJpeg }, t7).error.code, 'NOT_FOUND');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
