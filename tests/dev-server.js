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

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

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
