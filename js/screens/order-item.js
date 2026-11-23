// screens/order-item.js: one item card in the order editor. Fee lines, add-ons, package change,
// and the details form (jacket: style, size, patch spots with the patch picker; simple: notes).
// Applies the jacket rules from SPEC 5.8: left-sleeve surcharge, extra-patch limit, tier warning.
import { h, textInput, textArea, moneyInput, segmented, toggleRow, iconButton, sheet, searchBox, confirmDialog, setChildren } from '../ui.js';
import { store } from '../store.js';
import { formatCents, centsToInput, parseMoney } from '../money.js';
import {
  INCLUDED_SPOTS, extraLabel, extraSpots, needsCustomQuoteWarning, applyLeftSleeve, tierWarnings, newJacketDetails
} from '../rules.js';

/** Random id the server accepts and keeps (so checklists and spot links survive saves). */
export function clientId(prefix) {
  const r = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()) + Date.now()).replace(/[^a-z0-9]/gi, '');
  return prefix + '_' + r.slice(0, 14);
}

const TEMPLATE_KINDS = ['base', 'savings', 'upgrade'];

export function templateLines(packageId) {
  return store.data.templateLines.filter((l) => l.package_id === packageId)
    .map((l) => ({ line_id: clientId('L'), label: l.label, amount: centsToInput(l.amount_cents), kind: l.kind, addon_id: '' }));
}

export function autoTitle(product, pkg) {
  return product.name + (pkg && pkg.name !== 'Custom' ? ': ' + pkg.name : '');
}

/** A new item from a product and package, with the package lines copied in. */
export function newItem(product, pkg) {
  return {
    item_id: clientId('I'), product_id: product.product_id, package_id: pkg ? pkg.package_id : '',
    title: autoTitle(product, pkg), qty: 1,
    details: product.detail_form === 'jacket' ? newJacketDetails() : { notes: '' },
    lines: pkg ? templateLines(pkg.package_id) : []
  };
}

/** Lines with amounts as cents (invalid amounts count as 0 for live totals). */
export function linesInCents(item) {
  return item.lines.map((l) => ({ ...l, amount_cents: parseMoney(l.amount) || 0 }));
}

function productOf(item) {
  return store.data.products.find((p) => p.product_id === item.product_id) || null;
}

function leftSleeveAddOn(item) {
  return store.data.addOns.find((a) => a.product_id === item.product_id && a.active && a.rule === 'left_sleeve') || null;
}

/** Choose a product then a package. Calls onPick(product, pkg). */
export function pickProduct(onPick) {
  sheet((close) => {
    const body = h('div');
    const showProducts = () => setChildren(body,
      h('h2', null, 'Add item'),
      h('ul', { class: 'list' }, store.data.products.filter((p) => p.active).map((p) => h('li', null,
        h('button', { type: 'button', class: 'list-row button-row', onclick: () => {
          const pkgs = store.data.packages.filter((k) => k.product_id === p.product_id && k.active);
          if (pkgs.length <= 1) { close(); onPick(p, pkgs[0] || null); } else showPackages(p, pkgs);
        } }, h('span', { class: 'grow' }, p.name), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'))))));
    const showPackages = (p, pkgs) => setChildren(body,
      h('h2', null, p.name),
      h('p', { class: 'muted' }, 'Choose a package. Its lines are copied in and can be changed.'),
      packageList(pkgs, (k) => { close(); onPick(p, k); }),
      h('button', { type: 'button', class: 'btn-link', onclick: showProducts }, '‹ Back to products'));
    showProducts();
    return body;
  });
}

function packageList(pkgs, onPick) {
  return h('ul', { class: 'list' }, pkgs.map((k) => {
    const total = store.data.templateLines.filter((l) => l.package_id === k.package_id).reduce((t, l) => t + l.amount_cents, 0);
    return h('li', null, h('button', { type: 'button', class: 'list-row button-row', onclick: () => onPick(k) },
      h('span', { class: 'grow' }, k.name), h('span', { class: 'amount' }, total ? formatCents(total) : 'Custom price')));
  }));
}

/**
 * Build one item card.
 * ctx: { index, count, changed() [state changed, no redraw], redraw() [rebuild form], remove(), registerTotal(fn) }
 */
export function itemCard(item, ctx) {
  const product = productOf(item);
  const pkgs = store.data.packages.filter((k) => k.product_id === item.product_id && k.active);
  const pkg = store.data.packages.find((k) => k.package_id === item.package_id);

  // ----- header: title, package, quantity, remove -----
  const title = textInput(item.title, { maxlength: '200', 'aria-label': 'Item ' + (ctx.index + 1) + ' title' });
  title.addEventListener('input', () => { item.title = title.value; ctx.changed(); });

  const qtyText = h('span', { class: 'qty-value', 'aria-live': 'polite' }, String(item.qty));
  const setQty = (n) => {
    item.qty = Math.min(99, Math.max(1, n));
    qtyText.textContent = String(item.qty);
    ctx.changed();
  };
  const stepper = h('div', { class: 'stepper', role: 'group', 'aria-label': 'Quantity' },
    iconButton('Fewer', '−', () => setQty(item.qty - 1)), qtyText, iconButton('More', '+', () => setQty(item.qty + 1)));

  const removeBtn = h('button', { type: 'button', class: 'btn-link danger-link', onclick: async () => {
    if (await confirmDialog({ title: 'Remove this item?', message: item.title, yes: 'Remove item', danger: true })) ctx.remove();
  } }, 'Remove item');

  const changePkg = pkgs.length > 1 ? h('button', { type: 'button', class: 'btn-link', onclick: () => changePackage(item, product, pkgs, ctx) }, 'Change') : null;

  // ----- lines -----
  const totalEl = h('span', { class: 'amount' });
  const unitEl = h('span', { class: 'small muted' });
  const lineRows = item.lines.map((l, i) => {
    const label = textInput(l.label, { maxlength: '200', placeholder: 'Description', 'aria-label': 'Line ' + (i + 1) + ' description' });
    label.addEventListener('input', () => { l.label = label.value; ctx.changed(); });
    const amount = moneyInput(l.amount, { 'aria-label': 'Line ' + (i + 1) + ' amount' });
    amount.addEventListener('input', () => { l.amount = amount.value; ctx.changed(); });
    const del = iconButton('Delete line ' + (i + 1), '✕', () => { item.lines.splice(i, 1); ctx.redraw(); }, 'danger');
    const tag = l.kind === 'savings' ? 'Savings' : l.kind === 'upgrade' ? 'Upgrade' : l.kind === 'addon' ? 'Add-on' : null;
    return h('div', { class: 'order-line' },
      label,
      h('div', { class: 'line-bottom' }, tag ? h('span', { class: 'line-tag' }, tag) : null, h('span', { class: 'grow' }),
        h('span', { class: 'dollar', 'aria-hidden': 'true' }, '$'), amount, del));
  });

  ctx.registerTotal(() => {
    const unit = linesInCents(item).reduce((t, l) => t + l.amount_cents, 0);
    totalEl.textContent = formatCents(unit * item.qty);
    unitEl.textContent = item.qty > 1 ? formatCents(unit) + ' × ' + item.qty : '';
  });

  const addLine = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => {
    item.lines.push({ line_id: clientId('L'), label: '', amount: '', kind: 'custom', addon_id: '' });
    ctx.redraw({ focusLast: item.item_id });
  } }, '+ Add line');
  const addOns = store.data.addOns.filter((a) => a.product_id === item.product_id && a.active);
  const addAddOn = addOns.length ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => pickAddOn(addOns, (a) => {
    item.lines.push(addOnLine(a));
    ctx.redraw();
  }) }, '+ Add-on') : null;

  // ----- tier warnings -----
  const warnings = tierWarnings(item.details, linesInCents(item), store.data.patches);
  const warnBox = warnings.length ? h('div', { class: 'note-warn', role: 'note' },
    warnings.map((w) => h('p', null, w.message)),
    changePkg ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => changePackage(item, product, pkgs, ctx) }, 'Change package') : null) : null;

  return h('section', { class: 'item-card', 'data-item': item.item_id },
    h('div', { class: 'item-head' }, h('span', { class: 'label' }, 'Item ' + (ctx.index + 1)), removeBtn),
    title,
    h('div', { class: 'item-meta' },
      h('span', { class: 'muted' }, 'Package: ' + (pkg ? pkg.name : 'none')), changePkg,
      h('span', { class: 'grow' }), stepper),
    h('div', { class: 'order-lines' }, lineRows.length ? lineRows : h('p', { class: 'muted small' }, 'No lines yet. Add the fees for this item.')),
    h('div', { class: 'item-buttons' }, addLine, addAddOn),
    h('div', { class: 'item-total' }, h('span', null, 'Item total'), h('span', { class: 'right' }, unitEl, ' ', totalEl)),
    warnBox,
    h('div', { class: 'item-details' },
      h('h3', { class: 'label' }, 'Details'),
      product && product.detail_form === 'jacket' ? jacketForm(item, ctx) : simpleForm(item, ctx)));
}

function addOnLine(a) {
  return { line_id: clientId('L'), label: a.label, amount: centsToInput(a.amount_cents), kind: 'addon', addon_id: a.addon_id };
}

function pickAddOn(addOns, onPick) {
  sheet((close) => [
    h('h2', null, 'Add an add-on'),
    h('ul', { class: 'list' }, addOns.map((a) => h('li', null,
      h('button', { type: 'button', class: 'list-row button-row', onclick: () => { close(); onPick(a); } },
        h('span', { class: 'grow' }, a.label), h('span', { class: 'amount' }, (a.price_editable ? 'from ' : '') + formatCents(a.amount_cents)))))),
    h('p', { class: 'small muted', style: { marginTop: '12px' } }, 'You can change the price on the line after adding it.'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => close() }, 'Cancel'))
  ]);
}

/** Swap the package lines (base, savings, upgrade); add-on and custom lines stay. */
function changePackage(item, product, pkgs, ctx) {
  sheet((close) => [
    h('h2', null, 'Change package'),
    h('p', { class: 'muted' }, 'The package lines are replaced. Add-ons and lines you added stay.'),
    packageList(pkgs, (k) => {
      const oldPkg = store.data.packages.find((x) => x.package_id === item.package_id);
      if (item.title === autoTitle(product, oldPkg)) item.title = autoTitle(product, k);
      item.package_id = k.package_id;
      item.lines = templateLines(k.package_id).concat(item.lines.filter((l) => !TEMPLATE_KINDS.includes(l.kind)));
      close();
      ctx.redraw();
    }),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => close() }, 'Cancel'))
  ]);
}

/* ---------- details forms ---------- */

function simpleForm(item, ctx) {
  const notes = textArea(item.details.notes || '', { maxlength: '5000', rows: '4', 'aria-label': 'Details' });
  notes.addEventListener('input', () => { item.details.notes = notes.value; ctx.changed(); });
  return h('div', null,
    notes,
    h('p', { class: 'hint' }, 'Shown to the customer on their page.'),
    h('p', { class: 'hint' }, 'Photos can be added in a later update.'));
}

function textField(label, value, onInput, props = {}) {
  const input = textInput(value || '', Object.assign({ maxlength: '200', autocomplete: 'off' }, props));
  input.addEventListener('input', () => onInput(input.value));
  const id = 'jf' + Math.random().toString(36).slice(2, 8);
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input);
}

function choice(label, options, value, onPick) {
  return h('div', { class: 'field' }, h('span', null, label), segmented(options, value, onPick, label));
}

function jacketForm(item, ctx) {
  const d = item.details;
  if (!Array.isArray(d.spots)) Object.assign(d, newJacketDetails(), d);
  const set = (k) => (v) => { d[k] = v; ctx.changed(); };

  const designWrap = h('div', { hidden: !d.airbrushed }, textField('Airbrush design text', d.design_text, set('design_text')));
  const airbrushed = toggleRow('Airbrushed', d.airbrushed);
  airbrushed.input.addEventListener('change', () => { d.airbrushed = airbrushed.input.checked; designWrap.hidden = !d.airbrushed; ctx.changed(); });

  const regalia = textArea(d.regalia || '', { maxlength: '1000', rows: '2' });
  regalia.id = 'rg' + item.item_id;
  regalia.addEventListener('input', () => { d.regalia = regalia.value; ctx.changed(); });
  const notes = textArea(d.notes || '', { maxlength: '5000', rows: '3' });
  notes.id = 'nt' + item.item_id;
  notes.addEventListener('input', () => { d.notes = notes.value; ctx.changed(); });

  const extras = extraSpots(d);
  return h('div', null,
    choice('Style', [{ value: 'mens', label: 'Men\'s' }, { value: 'womens', label: 'Women\'s' }], d.style, set('style')),
    h('div', { class: 'two-col' },
      textField('Size', d.size, set('size'), { maxlength: '30', placeholder: 'e.g. L' }),
      textField('Color', d.color, set('color'), { maxlength: '50', placeholder: 'e.g. Black' })),
    choice('Order type', [{ value: 'freemason', label: 'Freemason' }, { value: 'oes', label: 'OES' }, { value: 'other', label: 'Other' }], d.order_type, set('order_type')),
    airbrushed, designWrap,
    h('div', { class: 'field' }, h('label', { for: regalia.id }, 'Regalia or emblem details'), regalia),

    h('h3', { class: 'label', style: { marginTop: '20px' } }, 'Patch spots'),
    h('p', { class: 'hint', style: { marginTop: '-4px', marginBottom: '10px' } }, 'Left and right are the wearer\'s.'),
    h('div', { class: 'spots' },
      INCLUDED_SPOTS.map((s) => spotCard(item, d.spots.find((x) => x.key === s.key) || addSpot(d, s.key), s.label, s.hint, ctx)),
      extras.map((s, i) => spotCard(item, s, extraLabel(i), null, ctx, true))),
    h('button', { type: 'button', class: 'btn btn-secondary btn-block', style: { marginTop: '12px' }, onclick: () => addExtraSpot(item, ctx) }, '+ Extra patch spot'),
    h('p', { class: 'hint' }, 'Up to 3 extra patches (7 in all) fit the package prices.'),

    h('div', { class: 'field', style: { marginTop: '16px' } }, h('label', { for: notes.id }, 'Notes'), notes),
    h('p', { class: 'hint' }, 'Photos can be added in a later update.'));
}

function addSpot(d, key) {
  const s = { key, patch_no: '', own_patch: false, notes: '' };
  if (key === 'sleeve') s.side = 'right';
  d.spots.push(s);
  return s;
}

function spotCard(item, spot, label, hint, ctx, isExtra = false) {
  const patch = spot.patch_no ? store.data.patches.find((p) => p.patch_no === spot.patch_no) : null;
  const pickBtn = h('button', { type: 'button', class: 'patch-pick', onclick: () => pickPatch(spot.patch_no, (no) => { spot.patch_no = no; ctx.redraw(); }) },
    patch ? [h('strong', null, 'No. ' + patch.patch_no), ' ', patch.name, patch.tier === 'premium' ? h('span', { class: 'badge badge-premium' }, 'Premium') : null]
      : spot.patch_no ? 'No. ' + spot.patch_no : h('span', { class: 'muted' }, 'Choose patch'),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
  pickBtn.setAttribute('aria-label', label + ' patch: ' + (patch ? 'No. ' + patch.patch_no + ' ' + patch.name : 'none chosen'));

  const own = toggleRow('Own patch', spot.own_patch);
  own.input.addEventListener('change', () => { spot.own_patch = own.input.checked; ctx.redraw(); });
  const notes = textInput(spot.notes || '', { maxlength: '200', placeholder: 'Notes (size, placement)', 'aria-label': label + ' notes' });
  notes.addEventListener('input', () => { spot.notes = notes.value; ctx.changed(); });

  let sideCtl = null;
  if (spot.key === 'sleeve') {
    sideCtl = segmented([{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }], spot.side || 'right', (v) => {
      spot.side = v;
      item.lines = applyLeftSleeve(item.lines.map((l) => ({ ...l, amount_cents: parseMoney(l.amount) || 0 })), v, leftSleeveAddOnFor(item), () => clientId('L'))
        .map((l) => (l.amount === undefined ? { ...l, amount: centsToInput(l.amount_cents) } : l));
      ctx.redraw();
    }, 'Sleeve side');
  }

  let where = null;
  let removeBtn = null;
  if (isExtra) {
    where = textInput(spot.where || '', { maxlength: '100', placeholder: 'Where on the jacket?', 'aria-label': label + ' location' });
    where.addEventListener('input', () => { spot.where = where.value; ctx.changed(); });
    removeBtn = iconButton('Remove ' + label, '✕', () => {
      item.details.spots = item.details.spots.filter((s) => s !== spot);
      if (spot.line_id) item.lines = item.lines.filter((l) => l.line_id !== spot.line_id);
      ctx.redraw();
    }, 'danger');
  }

  return h('div', { class: 'spot-card' },
    h('div', { class: 'spot-head' },
      h('div', { class: 'grow' }, h('strong', null, label), hint ? h('div', { class: 'hint', style: { margin: '0' } }, hint) : null),
      removeBtn),
    sideCtl, where, pickBtn, own, notes);
}

function leftSleeveAddOnFor(item) {
  return leftSleeveAddOn(item);
}

async function addExtraSpot(item, ctx) {
  if (needsCustomQuoteWarning(item.details)) {
    const ok = await confirmDialog({ title: 'More than 7 patches', message: 'More than 7 patches needs a custom quote. Add anyway?', yes: 'Add anyway', no: 'Cancel' });
    if (!ok) return;
  }
  const extraAddOns = store.data.addOns.filter((a) => a.product_id === item.product_id && a.active && a.rule === 'extra_patch');
  const finish = (addOn) => {
    const spot = { key: 'extra_' + clientId('x').slice(2), where: '', patch_no: '', own_patch: false, notes: '' };
    if (addOn) {
      const line = addOnLine(addOn);
      item.lines.push(line);
      spot.line_id = line.line_id;
      if (/own patch/i.test(addOn.label)) spot.own_patch = true;
    }
    item.details.spots.push(spot);
    ctx.redraw();
  };
  if (!extraAddOns.length) { finish(null); return; }
  sheet((close) => [
    h('h2', null, 'Price for this extra patch'),
    h('ul', { class: 'list' }, extraAddOns.map((a) => h('li', null,
      h('button', { type: 'button', class: 'list-row button-row', onclick: () => { close(); finish(a); } },
        h('span', { class: 'grow' }, a.label), h('span', { class: 'amount' }, (a.price_editable ? 'from ' : '') + formatCents(a.amount_cents)))))),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => { close(); finish(null); } }, 'No charge for now'),
      h('button', { type: 'button', class: 'btn-link', onclick: () => close() }, 'Cancel'))
  ]);
}

/** Patch picker: search by number or name; shows tier. onPick('' ) clears. */
function pickPatch(current, onPick) {
  sheet((close) => {
    const list = h('ul', { class: 'list' });
    const draw = (q) => {
      const t = q.trim().toLowerCase().replace(/^no\.?\s*/, '');
      const shown = store.data.patches.filter((p) => p.active && (!t ||
        p.patch_no.replace(/^0+/, '').startsWith(t.replace(/^0+/, '') || t) || p.name.toLowerCase().includes(t)));
      setChildren(list, shown.length ? shown.map((p) => h('li', null,
        h('button', { type: 'button', class: 'list-row button-row' + (p.patch_no === current ? ' selected' : ''), onclick: () => { close(); onPick(p.patch_no); } },
          h('div', { class: 'grow' },
            h('div', { class: 'title-line' }, h('strong', null, 'No. ' + p.patch_no), p.name,
              p.tier === 'premium' ? h('span', { class: 'badge badge-premium' }, 'Premium') : null),
            p.size ? h('div', { class: 'small muted' }, p.size) : null))))
        : h('li', null, h('p', { class: 'list-row muted' }, 'No patch matches.')));
    };
    const search = searchBox('Number or name', draw);
    draw('');
    if (window.matchMedia('(min-width: 768px)').matches) setTimeout(() => search.focus(), 50);
    return [
      h('h2', null, 'Choose a patch'),
      h('div', { class: 'toolbar' }, search),
      list,
      h('div', { class: 'actions' },
        current ? h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => { close(); onPick(''); } }, 'No patch') : null,
        h('button', { type: 'button', class: 'btn-link', onclick: () => close() }, 'Cancel'))
    ];
  });
}
