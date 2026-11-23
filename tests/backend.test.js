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
        if (f !== '@' && typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
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
      getFiles: () => iter(f.children.filter(x => x.kind === 'file' && !x.trashed))
    };
    files[f.id] = f;
    return f;
  };
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
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
      getFileById: () => ({
        makeCopy: (name, folder) => {
          const f = { kind: 'file', name, trashed: false, created: new Date(), getName: () => name, getUrl: () => 'https://drive/' + name,
            getDateCreated: () => f.created, setTrashed: (v) => { f.trashed = v; } };
          folder.children.push(f); return f;
        }
      })
    }
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'apps-script');
  const code = fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  vm.runInContext(code, ctx, { filename: 'apps-script.gs' });
  return { ctx, ss, sheets, props, cache, triggers, ui, root, answers };
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
  eq(table('Products').length, 3); eq(table('Patches').length, 45); eq(table('Settings').length, 20);
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
