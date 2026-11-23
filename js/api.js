// api.js: talks to the Apps Script back end. Handles the sign-in token and friendly errors.
import { API_URL } from './config.js';

const TOKEN_KEY = 'tr_token';
const TIMEOUT_MS = 30000;

// The token is kept in memory as well as localStorage, so the app still works for this
// visit if the browser blocks storage (private mode, some file:// pages).
let memToken = null;
let authLostHandler = null;

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function getToken() {
  if (memToken !== null) return memToken;
  try { memToken = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { memToken = ''; }
  return memToken;
}

export function setToken(token) {
  memToken = token || '';
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* storage blocked: memory copy still works */ }
}

export function clearToken() { setToken(''); }

/** Called whenever the server says the session is no longer valid. */
export function onAuthLost(fn) { authLostHandler = fn; }

/**
 * Call a back end action. Resolves with `data`, or throws ApiError whose message
 * is safe to show to Terri as is.
 */
export async function call(action, payload = {}) {
  if (!API_URL) {
    throw new ApiError('SETUP', 'The app is not connected to its back end yet. Add the Web App URL to js/config.js.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    // text/plain avoids a CORS preflight, which Apps Script cannot answer.
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: getToken(), payload }),
      signal: controller.signal
    });
  } catch (err) {
    throw new ApiError('NETWORK', err.name === 'AbortError'
      ? 'The server is taking too long. Please try again.'
      : 'Can\'t reach the server. Check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new ApiError('SERVER', 'The server sent something unexpected. Please try again.');
  }
  if (!json || !json.ok) {
    const e = (json && json.error) || {};
    if (e.code === 'AUTH') {
      clearToken();
      if (authLostHandler) authLostHandler();
    }
    throw new ApiError(e.code || 'SERVER', e.message || 'Something went wrong. Please try again.');
  }
  return json.data;
}

/** A short device name saved with the session, e.g. "iPhone (Home Screen)". */
export function deviceLabel() {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Browser';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return device + (standalone ? ' (Home Screen)' : ' (browser)');
}
