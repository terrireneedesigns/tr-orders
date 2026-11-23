// screens/products.js: Catalog tab, Products section. List, reorder, add.
import { h, segmented, iconButton, showError, setChildren } from '../ui.js';
import { store, loadBootstrap, setCatalog } from '../store.js';
import { call } from '../api.js';
import { navigate } from '../router.js';
import { formatCents, sumCents } from '../money.js';

/** Products | Patches switch shown at the top of both Catalog sections. */
export function catalogTabs(active) {
  return segmented(
    [{ value: 'products', label: 'Products' }, { value: 'patches', label: 'Patches' }],
    active,
    (v) => navigate(v === 'products' ? '/catalog' : '/catalog/patches', { replace: true }),
    'Catalog section');
}

export function catalogNote() {
  return h('p', { class: 'small muted', style: { margin: '12px 0 16px' } },
    'Changes here apply to new orders. Orders already made keep their prices.');
}

/** Total of a package's template lines, in cents. */
export function packageTotal(packageId) {
  return sumCents(store.data.templateLines.filter((l) => l.package_id === packageId));
}

export function packageSummary(productId) {
  return store.data.packages
    .filter((k) => k.product_id === productId && k.active)
    .map((k) => {
      const total = packageTotal(k.package_id);
      return k.name + (total ? ' ' + formatCents(total).replace('.00', '') : k.price_note ? ' ' + k.price_note : '');
    })
    .join(' · ');
}

const ID_KEYS = { products: 'product_id', packages: 'package_id', addOns: 'addon_id' };

/**
 * Save a new order for products, packages or add-ons. Shows the new order right away,
 * then saves; if saving fails it reloads the real order from the server.
 */
export async function saveOrder(kind, ids, redraw) {
  const key = ID_KEYS[kind];
  ids.forEach((id, i) => {
    const row = store.data[kind].find((x) => x[key] === id);
    if (row) row.sort = i + 1;
  });
  store.data[kind].sort((a, b) => a.sort - b.sort);
  redraw();
  try {
    const res = await call('catalog.reorder', { kind, ids });
    setCatalog(res.catalog);
  } catch (err) {
    showError(err);
    try { await loadBootstrap(); } catch (e) { /* keep what we have */ }
    redraw();
  }
}

/** ↑ and ↓ buttons for item i of n; the first can't go up and the last can't go down. */
export function reorderButtons(name, i, n, onMove) {
  const up = iconButton('Move ' + name + ' up', '↑', () => onMove(-1));
  const down = iconButton('Move ' + name + ' down', '↓', () => onMove(1));
  up.disabled = i === 0;
  down.disabled = i === n - 1;
  return h('div', { class: 'row-actions' }, up, down);
}

/** Move item i by dir (-1 up, +1 down) in a list of ids. Returns the new list. */
export function moved(ids, i, dir) {
  const out = ids.slice();
  const j = i + dir;
  if (j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export default {
  title: 'Catalog',
  tab: 'catalog',
  render(main) {
    const draw = () => {
      const products = store.data.products;
      const ids = products.map((p) => p.product_id);
      setChildren(main, 
        catalogTabs('products'),
        catalogNote(),
        h('ul', { class: 'list' }, products.map((p, i) => h('li', { class: p.active ? '' : 'muted-row' },
          h('div', { class: 'list-row' },
            h('a', { class: 'grow', href: '#/catalog/products/' + encodeURIComponent(p.product_id), style: { color: 'inherit', textDecoration: 'none' } },
              h('div', { class: 'title-line' }, p.name, p.active ? null : h('span', { class: 'badge badge-draft' }, 'Hidden')),
              h('div', { class: 'small muted' }, packageSummary(p.product_id) || 'No packages yet')),
            reorderButtons(p.name, i, ids.length, (dir) => saveOrder('products', moved(ids, i, dir), draw)))))),
        h('div', { class: 'section' },
          h('a', { class: 'btn btn-secondary btn-block', href: '#/catalog/products/new' }, '+ Add product')));
    };
    draw();
    return async () => { await loadBootstrap(); draw(); };
  }
};
