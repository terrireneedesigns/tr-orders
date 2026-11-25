// screens/package-edit.js: add or edit a package and its price lines (template lines).
// Selecting a package on an order copies these lines into the order, where they can be changed.
import { h, field, textInput, selectInput, toggleRow, moneyInput, iconButton, toast, withBusy, setChildren } from '../ui.js';
import { store, setCatalog } from '../store.js';
import { call, ApiError } from '../api.js';
import { back } from '../router.js';
import { formatCents, centsToInput, parseMoney } from '../money.js';
import { catalogNote } from './products.js';
import { typicalCostsEditor } from '../tracking.js';

const KINDS = [
  { value: 'base', label: 'Normal fee' },
  { value: 'savings', label: 'Package savings (minus)' },
  { value: 'upgrade', label: 'Upgrade' }
];

export default {
  title: (p) => (p.id ? 'Package' : 'New Package'),
  tab: 'catalog',
  back: true,
  render(main, params, view) {
    const pkg = params.id ? store.data.packages.find((k) => k.package_id === params.id) : null;
    const productId = pkg ? pkg.product_id : params.query.product;
    const product = store.data.products.find((p) => p.product_id === productId);
    if ((params.id && !pkg) || !product) {
      setChildren(main, h('div', { class: 'card empty' }, h('h2', null, 'Package not found'),
        h('a', { class: 'btn btn-secondary', href: '#/catalog' }, 'Back to Catalog')));
      return;
    }
    view.setTitle(pkg ? pkg.name + ' package' : 'New package');

    // Working copy of the lines; amounts are kept as the text typed.
    const lines = store.data.templateLines
      .filter((l) => pkg && l.package_id === pkg.package_id)
      .map((l) => ({ template_line_id: l.template_line_id, label: l.label, amount: centsToInput(l.amount_cents), kind: l.kind }));

    const typical = typicalCostsEditor((store.data.packageCosts || []).filter((c) => pkg && c.package_id === pkg.package_id));

    const name = textInput(pkg ? pkg.name : '', { maxlength: '100', autocomplete: 'off' });
    const priceNote = textInput(pkg ? pkg.price_note : '', { maxlength: '50', autocomplete: 'off' });
    const active = toggleRow('Show in new orders', pkg ? pkg.active : true);
    const editor = h('div', { class: 'line-editor' });
    const totalEl = h('span', { class: 'amount' });

    const updateTotal = () => {
      const sum = lines.reduce((t, l) => t + (parseMoney(l.amount) || 0), 0);
      totalEl.textContent = formatCents(sum);
    };

    const drawLines = () => {
      setChildren(editor, ...lines.map((l, i) => {
        const label = textInput(l.label, { maxlength: '200', autocomplete: 'off', 'aria-label': 'Line ' + (i + 1) + ' description', placeholder: 'Description' });
        label.addEventListener('input', () => { l.label = label.value; });
        const amount = moneyInput(l.amount, { 'aria-label': 'Line ' + (i + 1) + ' amount' });
        amount.addEventListener('input', () => { l.amount = amount.value; updateTotal(); });
        const kind = selectInput(KINDS, l.kind, { 'aria-label': 'Line ' + (i + 1) + ' type' });
        kind.addEventListener('change', () => { l.kind = kind.value; });
        const up = iconButton('Move line ' + (i + 1) + ' up', '↑', () => { swap(i, i - 1); });
        const down = iconButton('Move line ' + (i + 1) + ' down', '↓', () => { swap(i, i + 1); });
        const del = iconButton('Delete line ' + (i + 1), '✕', () => { lines.splice(i, 1); drawLines(); }, 'danger');
        up.disabled = i === 0;
        down.disabled = i === lines.length - 1;
        return h('div', { class: 'line-card' }, label, kind,
          h('div', { class: 'line-bottom' }, h('span', { class: 'dollar', 'aria-hidden': 'true' }, '$'), amount, h('span', { class: 'grow' }), up, down, del));
      }));
      if (!lines.length) editor.append(h('p', { class: 'muted' }, 'No price lines yet. Orders using this package start empty and you add lines on each order.'));
      updateTotal();
    };

    const swap = (i, j) => {
      if (j < 0 || j >= lines.length) return;
      [lines[i], lines[j]] = [lines[j], lines[i]];
      drawLines();
    };

    const addLine = h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => {
      lines.push({ template_line_id: '', label: '', amount: '', kind: 'base' });
      drawLines();
      const inputs = editor.querySelectorAll('.line-card input[type="text"]:not(.money)');
      if (inputs.length) inputs[inputs.length - 1].focus();
    } }, '+ Add line');

    const save = h('button', { class: 'btn btn-block', type: 'submit' }, 'Save package');
    const form = h('form', { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      withBusy(save, 'Saving…', async () => {
        if (!name.value.trim()) throw new ApiError('VALIDATION', 'Please type a package name.');
        const out = lines.map((l, i) => {
          const n = i + 1;
          const cents = parseMoney(l.amount);
          if (!l.label.trim()) throw new ApiError('VALIDATION', 'Line ' + n + ' needs a description.');
          if (cents === null) throw new ApiError('VALIDATION', 'Line ' + n + ' needs an amount, like 45 or 45.00.');
          if (l.kind === 'savings' && cents > 0) {
            throw new ApiError('VALIDATION', 'Line ' + n + ' is a savings line, so its amount should be negative, like -3.00.');
          }
          return { template_line_id: l.template_line_id, label: l.label, amount_cents: cents, kind: l.kind };
        });
        const costs = typical.collect();
        const res = await call('catalog.savePackage', {
          package_id: pkg ? pkg.package_id : undefined, product_id: product.product_id,
          name: name.value, price_note: priceNote.value, active: active.input.checked, lines: out
        });
        setCatalog(res.catalog);
        const before = JSON.stringify((store.data.packageCosts || []).filter((c) => c.package_id === res.id)
          .map((c) => ({ category: c.category, description: c.description, amount_cents: c.amount_cents })));
        if (JSON.stringify(costs) !== before) {
          setCatalog((await call('catalog.savePackageCosts', { package_id: res.id, costs })).catalog);
        }
        toast('Package saved');
        back('/catalog/products/' + encodeURIComponent(product.product_id));
      });
    } },
    field('Package name', name),
    field('Price note (optional)', priceNote, 'Shown next to the name, e.g. "$275".'),
    active,
    h('h2', { class: 'label section' }, 'Price lines'),
    h('p', { class: 'small muted' }, 'These lines are copied into each new order that uses this package. They can still be changed on the order.'),
    editor,
    h('div', { class: 'line-total' }, h('span', null, 'Package total'), totalEl),
    h('div', { class: 'section' }, addLine),
    h('h2', { class: 'label section' }, 'Typical costs (only you see these)'),
    h('p', { class: 'small muted' }, 'What you usually spend to make one item with this package. New orders start with these costs, and you change them on the order if you paid something different.'),
    typical.el,
    h('div', { class: 'form-actions' }, save));

    setChildren(main, h('p', { class: 'label', style: { marginBottom: '0' } }, product.name), catalogNote(), form);
    drawLines();
  }
};
