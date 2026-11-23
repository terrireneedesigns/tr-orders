// ui.js: small shared UI helpers. All text goes through textContent, never innerHTML,
// so customer and order text can never inject markup.

/**
 * Create an element: h('button', { class: 'btn', onclick: fn }, 'Save').
 * Children may be strings, numbers, nodes, arrays, or null/false (skipped).
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Build an inline SVG icon from path data (trusted constants only). */
export function icon(paths) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/* ---------- toast ---------- */

let toastWrap = null;

export function toast(message, { error = false, ms = 3000 } = {}) {
  if (!toastWrap) {
    toastWrap = h('div', { class: 'toast-wrap', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastWrap);
  }
  const t = h('div', { class: 'toast' + (error ? ' toast-error' : '') }, message);
  toastWrap.appendChild(t);
  setTimeout(() => t.remove(), error ? Math.max(ms, 5000) : ms);
}

/** Show any error (ApiError or not) as a toast with a friendly message. */
export function showError(err) {
  const msg = err && err.message && err.code ? err.message : 'Something went wrong. Please try again.';
  if (!(err && err.code)) console.error(err);
  toast(msg, { error: true });
}

/* ---------- bottom sheet and confirm ---------- */

/** Open a bottom sheet. Returns { el, close }. `build(close)` returns the sheet content. */
export function sheet(build, { onClose } = {}) {
  const prevFocus = document.activeElement;
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
  backdrop.appendChild(panel);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
    if (onClose) onClose(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  appendAll(panel, [build(close)]);
  document.body.appendChild(backdrop);
  panel.focus();
  return { el: panel, close };
}

/** Ask a yes/no question. Resolves true or false. */
export function confirmDialog({ title, message, yes = 'Yes', no = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    sheet((close) => [
      h('h2', null, title),
      message ? h('p', null, message) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn btn-block' + (danger ? ' btn-danger' : ''), onclick: () => close(true) }, yes),
        h('button', { class: 'btn btn-secondary btn-block', onclick: () => close(false) }, no))
    ], { onClose: (r) => resolve(r === true) });
  });
}

/* ---------- pull to refresh ---------- */

/**
 * Pull down at the top of the page to refresh (Home Screen apps on iPhone have no
 * built-in pull-to-refresh). `getHandler()` returns the current screen's refresh
 * function, or null when the screen has nothing to refresh.
 */
export function enablePullToRefresh(indicator, getHandler) {
  const THRESHOLD = 70;
  let startY = null;
  let pull = 0;
  let busy = false;

  const set = (px, text) => {
    indicator.style.height = px + 'px';
    indicator.textContent = text || '';
  };

  window.addEventListener('touchstart', (e) => {
    if (busy || window.scrollY > 0 || !getHandler() || e.touches.length !== 1) { startY = null; return; }
    if (e.target.closest('.sheet-backdrop, input, textarea, select')) { startY = null; return; }
    startY = e.touches[0].clientY;
    pull = 0;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    pull = Math.max(0, e.touches[0].clientY - startY);
    if (window.scrollY > 0) { startY = null; set(0); return; }
    const shown = Math.min(90, pull * 0.5);
    set(shown, pull > THRESHOLD ? 'Release to refresh' : shown > 16 ? 'Pull to refresh' : '');
  }, { passive: true });

  window.addEventListener('touchend', async () => {
    if (startY === null) return;
    startY = null;
    const handler = getHandler();
    if (pull > THRESHOLD && handler) {
      busy = true;
      set(40, 'Refreshing…');
      try { await handler(); } catch (err) { showError(err); }
      busy = false;
    }
    set(0);
  });
}

/* ---------- formatting ---------- */

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('en-US', {
    timeZone: 'America/Phoenix', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}
