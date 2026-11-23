// app.js: starts the admin app: sign-in check, header, tab bar, routes, service worker.
import { APP_VERSION } from './config.js';
import { getToken, onAuthLost } from './api.js';
import { route, fallback, start as startRouter, resolve, navigate } from './router.js';
import { store, loadBootstrap, clearStore } from './store.js';
import { h, icon, enablePullToRefresh, showError } from './ui.js';
import { renderLogin } from './screens/login.js';
import home from './screens/home.js';
import orders from './screens/orders.js';
import customers from './screens/customers.js';
import catalog from './screens/products.js';
import settings from './screens/settings.js';
import comingSoon from './screens/coming-soon.js';

const root = document.getElementById('app');

const TABS = [
  { id: 'home', path: '/home', label: 'Home', icon: ['M3 11l9-7 9 7', 'M5 9.5V20h14V9.5', 'M10 20v-6h4v6'] },
  { id: 'orders', path: '/orders', label: 'Orders', icon: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'] },
  { id: 'customers', path: '/customers', label: 'Customers', icon: [
    'M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1', 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M21 19v-1a4 4 0 0 0-3-3.85', 'M15 5.15a3 3 0 0 1 0 5.7'] },
  { id: 'catalog', path: '/catalog', label: 'Catalog', icon: [
    'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z', 'M7.5 7.5h.01'] },
  { id: 'settings', path: '/settings', label: 'Settings', icon: [
    'M4 6h9', 'M17 6h3', 'M15 4v4', 'M4 12h3', 'M11 12h9', 'M9 10v4', 'M4 18h11', 'M19 18h1', 'M17 16v4'] }
];

let shell = null;          // { header, title, back, main, tabLinks, pull }
let refreshHandler = null; // current screen's pull-to-refresh function
let routerStarted = false;
let renderToken = 0;       // ignore results from screens the user already left

/* ---------- shell ---------- */

// Opened straight from a link there is no page to go back to, so go Home instead.
function goBack() {
  if (history.length > 1) history.back();
  else navigate('/home');
}

function buildShell() {
  const title = h('h1', { class: 'title' });
  const back = h('button', { class: 'back', type: 'button', 'aria-label': 'Back', hidden: true, onclick: goBack }, '‹');
  const monogram = h('img', { src: 'assets/logo-monogram-sm.png', alt: '', width: '52', height: '40' });
  const header = h('header', { class: 'app-header' }, back, monogram, title);
  const pull = h('div', { class: 'pull-indicator', 'aria-hidden': 'true' });
  const main = h('main', { class: 'app-main', id: 'main', tabindex: '-1' });
  const tabLinks = {};
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Main' },
    TABS.map((t) => (tabLinks[t.id] = h('a', { href: '#' + t.path }, icon(t.icon), h('span', null, t.label)))));
  root.replaceChildren(header, pull, main, tabbar);
  shell = { header, title, back, main, tabLinks, pull, monogram };
  enablePullToRefresh(pull, () => refreshHandler);
}

/**
 * Show a screen. A screen is { title, tab, back?, render(main, params) }.
 * render may be async and may return a refresh function for pull-to-refresh.
 */
async function mount(screen, params = {}) {
  if (!store.data) return; // signed out
  if (!shell) buildShell();
  const myToken = ++renderToken;
  const title = typeof screen.title === 'function' ? screen.title(params) : screen.title;
  shell.title.textContent = title;
  document.title = title + ' · TR Orders';
  shell.back.hidden = !screen.back;
  shell.monogram.hidden = !!screen.back;
  for (const [id, a] of Object.entries(shell.tabLinks)) {
    if (id === screen.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  refreshHandler = null;
  shell.main.replaceChildren();
  window.scrollTo(0, 0);
  try {
    const refresh = await screen.render(shell.main, params);
    if (myToken === renderToken && typeof refresh === 'function') refreshHandler = refresh;
  } catch (err) {
    if (myToken !== renderToken) return;
    showError(err);
  }
}

/* ---------- routes ---------- */

route('/home', () => mount(home));
route('/orders', () => mount(orders));
route('/customers', () => mount(customers));
route('/catalog', () => mount(catalog));
route('/settings', () => mount(settings));
route('/new/:type', (p) => mount(comingSoon, p));
fallback(() => navigate('/home', { replace: true }));

/* ---------- sign in / start ---------- */

function showLogin(message) {
  shell = null;
  refreshHandler = null;
  clearStore();
  renderLogin(root, { message, onSuccess: startApp });
}

function showBoot() {
  root.replaceChildren(h('div', { class: 'boot', role: 'status', 'aria-label': 'Loading' },
    h('img', { src: 'assets/logo-monogram-sm.png', alt: 'TR Orders is loading', width: '160', height: '124' })));
}

function showStartError(err) {
  root.replaceChildren(h('div', { class: 'login' },
    h('div', { class: 'login-inner' },
      h('img', { src: 'assets/logo-full-sm.png', alt: 'Terri Renee Evolvé', width: '220', height: '184' }),
      h('p', { class: 'error' }, err.message || 'Something went wrong.'),
      h('button', { class: 'btn btn-gold btn-block', onclick: boot }, 'Try again'))));
}

/** After sign-in (or with a saved token): load data, then show the app. */
async function startApp() {
  showBoot();
  try {
    await loadBootstrap();
  } catch (err) {
    if (err.code === 'AUTH') return; // onAuthLost already showed the sign-in screen
    showStartError(err);
    return;
  }
  shell = null;
  buildShell();
  if (!routerStarted) {
    routerStarted = true;
    startRouter();
  } else {
    resolve();
  }
}

function boot() {
  if (!getToken()) showLogin();
  else startApp();
}

export function signedOut(message) {
  showLogin(message);
}

onAuthLost(() => showLogin('Please sign in again.'));

/* ---------- service worker (offline app shell) ---------- */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
  });
}

console.info('TR Orders ' + APP_VERSION);
boot();
