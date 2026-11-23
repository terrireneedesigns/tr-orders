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

/** Current path without the leading '#', e.g. '/orders/TR-1001'. */
export function currentPath() {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : '/home';
}

export function navigate(path, { replace = false } = {}) {
  const hash = '#' + path;
  if (location.hash === hash) { resolve(); return; }
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) resolve();
}

export function resolve() {
  const path = currentPath();
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
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
