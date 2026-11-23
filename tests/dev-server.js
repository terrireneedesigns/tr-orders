#!/usr/bin/env node
/**
 * Local dev server: serves the site at http://localhost:8080/tr-orders/ (same path as
 * GitHub Pages) with a FAKE back end at /api, built from the real apps-script/*.gs code
 * running on the fakes in backend.test.js. Data lives in memory and resets on restart.
 *
 *   node tests/dev-server.js            then open http://localhost:8080/tr-orders/
 *   Passcode for the fake back end:     123456
 *
 * js/config.js is served with API_URL pointed at the fake; the file on disk is not changed.
 * Developer tool only. No npm packages needed.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeEnv } = require('./backend.test.js');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.join(__dirname, '..');
const BASE = '/tr-orders/';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8'
};

const env = makeEnv(['123456', '123456']);
env.ctx.setup();

const api = (action, payload, token) => JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify({ action, token, payload }) } }).getContent());
let demoToken = null;

/** Sample data for screenshots: a customer, a paid jacket order in progress, a sent quote, a draft, a ready order. */
function seedDemo() {
  if (demoToken) return demoToken;
  const t = api('auth.login', { passcode: '123456', label: 'Demo' }).data.token;
  const boot = api('bootstrap', { app_url: 'http://localhost:' + PORT + BASE }, t).data;
  const c = api('customers.save', { name: 'Denise Carter', phone: '480-555-0199', email: 'denise@example.com', notes: "Women's L. Loves gold." }, t).data.customer;
  const c2 = api('customers.save', { name: 'Marcus Bell', phone: '602-555-0111' }, t).data.customer;
  const pk = boot.packages.find((p) => p.name === 'Standard');
  const lines = boot.templateLines.filter((l) => l.package_id === pk.package_id).map((l) => ({ label: l.label, amount_cents: l.amount_cents, kind: l.kind }));
  const ls = boot.addOns.find((a) => a.rule === 'left_sleeve');
  const xs = boot.addOns.find((a) => a.label.startsWith('Extra small patch'));
  const jacket = { product_id: pk.product_id, package_id: pk.package_id, title: 'Custom Bomber Jacket: Standard', qty: 1,
    details: { style: 'womens', size: 'L', color: 'Black', order_type: 'oes', spots: [
      { key: 'back', patch_no: '35' }, { key: 'left_chest', patch_no: '03' }, { key: 'right_chest', patch_no: '06' },
      { key: 'sleeve', side: 'left', patch_no: '10' }, { key: 'extra_a1', where: 'collar', patch_no: '01', line_id: 'L_demo_x1' },
      { key: 'extra_b1', where: 'cuff', patch_no: '02', line_id: 'L_demo_x2' }], notes: 'Purple satin lining.' },
    lines: lines.concat([{ label: ls.label, amount_cents: 1000, kind: 'addon', addon_id: ls.addon_id },
      { line_id: 'L_demo_x1', label: xs.label, amount_cents: 2800, kind: 'addon', addon_id: xs.addon_id },
      { line_id: 'L_demo_x2', label: xs.label, amount_cents: 2800, kind: 'addon', addon_id: xs.addon_id }]) };
  const a = api('docs.save', { type: 'invoice', customer_id: c.customer_id, est_ready_date: '2026-12-15', customer_note: 'Thank you for your order, Denise!', items: [jacket] }, t).data;
  api('docs.markSent', { doc_id: a.doc.doc_id, method: 'share' }, t);
  api('payments.add', { doc_id: a.doc.doc_id, amount_cents: 34100, method: 'zelle' }, t);
  api('checklist.toggle', { doc_id: a.doc.doc_id, item_id: a.items[0].item_id, step_no: 2 }, t);
  const q = api('docs.save', { type: 'quote', customer_id: c2.customer_id, items: [Object.assign({}, jacket, { lines })] }, t).data;
  api('docs.markSent', { doc_id: q.doc.doc_id }, t);
  api('docs.save', { type: 'invoice', customer_id: c2.customer_id, items: [{ title: 'Custom Hat', qty: 1, details: { notes: 'Black cap, gold OES star.' }, lines: [{ label: 'Embroidered cap', amount_cents: 4500, kind: 'custom' }] }] }, t);
  const r = api('docs.save', { type: 'invoice', customer_id: c.customer_id, fulfillment: 'delivery', items: [{ title: 'Custom Purse', qty: 1, details: { notes: 'Gold clasp.' }, lines: [{ label: 'Purse and labor', amount_cents: 15000, kind: 'custom' }] }] }, t).data;
  api('docs.markSent', { doc_id: r.doc.doc_id }, t);
  api('payments.add', { doc_id: r.doc.doc_id, amount_cents: 15000, method: 'cash' }, t);
  api('docs.setStage', { doc_id: r.doc.doc_id, stage: 'ready' }, t);
  demoToken = t;
  return { token: t, invoicePublicId: a.doc.public_id, quotePublicId: q.doc.public_id };
}
let demo = null;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Developer only: /dev/open?to=/home signs in with demo data and opens that screen.
  // /dev/open?view=invoice|quote opens the customer page for a demo order.
  if (url.pathname === '/dev/open') {
    demo = demo || seedDemo();
    const to = url.searchParams.get('to') || '/home';
    const view = url.searchParams.get('view');
    const target = view ? BASE + 'view.html?id=' + (view === 'quote' ? demo.quotePublicId : demo.invoicePublicId)
      : BASE + 'index.html#' + to;
    const setToken = view ? "localStorage.removeItem('tr_token');" : 'localStorage.setItem("tr_token", ' + JSON.stringify(demo.token) + ');';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><script>' + setToken + 'location.replace(' + JSON.stringify(target) + ');</script>');
    return;
  }

  if (url.pathname === '/api') {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const out = env.ctx.doPost({ postData: { contents: body } }).getContent();
      const action = (() => { try { return JSON.parse(body).action; } catch (e) { return '?'; } })();
      console.log(`API ${action} (${req.headers['content-type']}) -> ${JSON.parse(out).ok ? 'ok' : JSON.parse(out).error.code}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(out);
    });
    return;
  }

  if (url.pathname === '/' || url.pathname === '/tr-orders') {
    res.writeHead(302, { Location: BASE }); res.end(); return;
  }
  if (!url.pathname.startsWith(BASE)) { res.writeHead(404); res.end('Not found'); return; }

  let rel = decodeURIComponent(url.pathname.slice(BASE.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('Not found'); return;
  }
  let data = fs.readFileSync(file);
  if (rel === 'js/config.js') {
    data = Buffer.from(data.toString('utf8').replace(/export const API_URL = '.*?';/, "export const API_URL = '/api';"));
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(data);
}).listen(PORT, () => console.log(`TR Orders dev server: http://localhost:${PORT}${BASE}  (fake passcode 123456)`));
