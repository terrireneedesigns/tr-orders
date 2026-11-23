// router.js: tiny hash router. Routes look like '#/home' or '#/orders/:number'.

const routes = [];
let notFound = null;
let listener = null;

/** Register a route pattern, e.g. route('/orders/:number', handler). */
export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => {
    keys.push(k);
    return '/([^/]+)';
  }) + '/?$');
  routes.push({ re, keys, handler });
}

export function fallback(handler) { notFound = handler; }

/** Current path without the leading '#' or any '?query', e.g. '/orders/TR-1001'. */
export function currentPath() {
  const h = location.hash.replace(/^#/, '').split('?')[0];
  return h.startsWith('/') ? h : '/home';
}

/** Query values after '?' in the hash, e.g. '#/new/order?customer=C_1' -> { customer: 'C_1' }. */
export function currentQuery() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}

export function navigate(path, { replace = false } = {}) {
  const hash = '#' + path;
  if (location.hash === hash) { resolve(); return; }
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) resolve();
}

/** Go back one screen, or to `fallback` when the app was opened straight on this screen. */
export function back(fallback = '/home') {
  if (history.length > 1) history.back();
  else navigate(fallback, { replace: true });
}

export function resolve() {
  const path = currentPath();
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = { query: currentQuery() };
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      r.handler(params, path);
      return;
    }
  }
  if (notFound) notFound(path);
}

export function start() {
  if (listener) return;
  listener = () => resolve();
  window.addEventListener('hashchange', listener);
  resolve();
}
