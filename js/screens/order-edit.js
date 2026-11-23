// screens/order-edit.js: create or edit a quote or invoice (SPEC 6.4).
// Customer, items (see order-item.js), pickup/delivery, totals, notes, more options, Save.
// Keeps a local draft in localStorage while editing so nothing is lost if the app closes.
import {
  h, field, textInput, textArea, moneyInput, segmented, searchBox, sheet, toast, withBusy, formatDateTime, setChildren
} from '../ui.js';
import { store, findCustomer, upsertCustomer } from '../store.js';
import { call, ApiError } from '../api.js';
import { navigate, back } from '../router.js';
import { formatCents, centsToInput, parseMoney } from '../money.js';
import { computeTotals, upfrontCents } from '../rules.js';
import { itemCard, pickProduct, newItem, linesInCents } from './order-item.js';
import { askUseExisting } from './customer-edit.js';

const DRAFT_PREFIX = 'tr_draft_';

function draftKey(state) {
  return DRAFT_PREFIX + (state.doc_id || 'new_' + state.type);
}

function readDraft(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}

function writeDraft(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
}

function clearDraft(key) {
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

/** Editor state from a saved document (docs.get result). */
function stateFromDoc(res) {
  const d = res.doc;
  return {
    doc_id: d.doc_id, number: d.number, type: d.type, status: d.status, sent_at: d.sent_at,
    base_updated_at: d.updated_at,
    customer_id: d.customer_id, fulfillment: d.fulfillment || 'pickup', est_ready_date: d.est_ready_date || '',
    discount: d.discount_cents ? centsToInput(d.discount_cents) : '', discount_label: d.discount_label || '',
    show_discount: !!d.discount_cents,
    customer_note: d.customer_note || '', internal_notes: d.internal_notes || '',
    upfront_percent: String(d.upfront_percent || 100),
    items: res.items.map((it) => ({
      item_id: it.item_id, product_id: it.product_id, package_id: it.package_id, title: it.title, qty: it.qty,
      details: it.details || {},
      lines: it.lines.map((l) => ({ line_id: l.line_id, label: l.label, amount: centsToInput(l.amount_cents), kind: l.kind, addon_id: l.addon_id }))
    }))
  };
}

function newState(type, customerId) {
  return {
    doc_id: '', number: '', type, status: 'draft', sent_at: '', base_updated_at: '',
    customer_id: customerId && findCustomer(customerId) ? customerId : '',
    fulfillment: 'pickup', est_ready_date: '', discount: '', discount_label: '', show_discount: false,
    customer_note: '', internal_notes: '', upfront_percent: String(store.data.settings.upfront_percent_default || 100),
    items: []
  };
}

export default {
  title: (p) => (p.number ? 'Edit ' + p.number : p.type === 'quote' ? 'New Quote' : 'New Order'),
  tab: 'orders',
  back: true,
  async render(main, params, view) {
    let state;
    if (params.number) {
      setChildren(main, h('div', { class: 'spinner', 'aria-label': 'Loading' }));
      const res = await call('docs.get', { number: params.number });
      if (!view.isCurrent()) return;
      if (res.doc.status === 'void' || res.doc.status === 'converted') {
        setChildren(main, h('div', { class: 'card empty' },
          h('h2', null, res.doc.status === 'void' ? 'This order is void' : 'This quote became an invoice'),
          h('p', null, res.doc.status === 'void' ? 'Void orders can\'t be changed.' : 'Edit the invoice instead.'),
          h('a', { class: 'btn btn-secondary', href: '#/orders/' + encodeURIComponent(res.doc.number) }, 'Back to ' + res.doc.number)));
        return;
      }
      state = stateFromDoc(res);
    } else {
      state = newState(params.type === 'quote' ? 'quote' : 'invoice', params.query.customer);
    }

    const key = draftKey(state);
    const saved = readDraft(key);
    let draftBanner = null;
    if (saved && saved.state && (!params.number || saved.state.doc_id === state.doc_id)) {
      const stale = params.number && saved.base_updated_at !== state.base_updated_at;
      draftBanner = h('div', { class: 'note-warn', role: 'note' },
        h('p', null, 'You have unsaved changes from ' + formatDateTime(saved.saved_at) + '.' +
          (stale ? ' This order was saved again since then.' : '')),
        h('div', { class: 'row-buttons' },
          h('button', { type: 'button', class: 'btn', onclick: () => { state = saved.state; draftBanner = null; draw(); } }, 'Restore them'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { clearDraft(key); draftBanner = null; draw(); } }, 'Discard')));
    }

    // ----- change tracking -----
    let draftTimer = null;
    const totalUpdaters = [];
    const persist = () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        if (draftBanner) return; // don't overwrite an offered draft until the choice is made
        writeDraft(key, { saved_at: new Date().toISOString(), base_updated_at: state.base_updated_at, state });
      }, 400);
    };
    const refreshTotals = () => totalUpdaters.forEach((fn) => fn());
    const changed = () => { refreshTotals(); persist(); };

    const draw = (opts = {}) => {
      const y = window.scrollY;
      totalUpdaters.length = 0;
      const isQuote = state.type === 'quote';
      setChildren(main,
        draftBanner,
        isQuote && state.sent_at ? h('div', { class: 'note-warn', role: 'note' },
          h('p', null, 'This quote was already sent. The customer may have seen the old version, so send it again after saving.')) : null,
        customerSection(),
        itemsSection(opts),
        fulfillmentSection(),
        totalsSection(),
        notesSection(),
        moreOptions(),
        h('div', { class: 'form-actions two' }, saveButton(false), saveButton(true)));
      refreshTotals();
      window.scrollTo(0, y);
      if (opts.focusLast) {
        const card = main.querySelector('[data-item="' + opts.focusLast + '"]');
        const inputs = card ? card.querySelectorAll('.order-line input:not(.money)') : [];
        if (inputs.length) inputs[inputs.length - 1].focus();
      }
      persist();
    };

    // ----- customer -----
    const customerSection = () => {
      const c = state.customer_id ? findCustomer(state.customer_id) : null;
      if (c) {
        return h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Customer'),
          h('div', { class: 'card customer-chosen' },
            h('div', { class: 'grow' }, h('div', { style: { fontWeight: '500' } }, c.name),
              h('div', { class: 'small muted' }, [c.phone, c.email].filter(Boolean).join(' · ') || 'No phone or email')),
            h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { state.customer_id = ''; draw(); } }, 'Change')));
      }
      const results = h('ul', { class: 'list', hidden: true });
      const showResults = (q) => {
        const t = q.trim().toLowerCase();
        const digits = t.replace(/\D/g, '');
        const found = t ? store.data.customers.filter((x) => !x.archived && (x.name.toLowerCase().includes(t) ||
          (x.email || '').toLowerCase().includes(t) || (digits.length >= 3 && (x.phone || '').replace(/\D/g, '').includes(digits)))).slice(0, 8) : [];
        results.hidden = !found.length;
        setChildren(results, found.map((x) => h('li', null,
          h('button', { type: 'button', class: 'list-row button-row', onclick: () => { state.customer_id = x.customer_id; draw(); } },
            h('div', { class: 'grow' }, h('div', null, x.name), h('div', { class: 'small muted' }, [x.phone, x.email].filter(Boolean).join(' · ')))))));
      };
      return h('section', { class: 'section' },
        h('h2', { class: 'label' }, 'Customer'),
        h('div', { class: 'toolbar' },
          searchBox('Search customers', showResults),
          h('button', { type: 'button', class: 'btn', onclick: () => newCustomerSheet((cust) => { state.customer_id = cust.customer_id; draw(); }) }, '+ New')),
        results);
    };

    // ----- items -----
    const itemsSection = () => h('section', { class: 'section' },
      h('h2', { class: 'label' }, 'Items'),
      state.items.length ? null : h('p', { class: 'muted' }, 'No items yet.'),
      state.items.map((item, i) => itemCard(item, {
        index: i, count: state.items.length, changed, redraw: draw,
        remove: () => { state.items.splice(i, 1); draw(); },
        registerTotal: (fn) => totalUpdaters.push(fn)
      })),
      h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => pickProduct((p, k) => {
        state.items.push(newItem(p, k));
        draw();
        const cards = main.querySelectorAll('.item-card');
        if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'start', behavior: 'smooth' });
      }) }, '+ Add item'));

    // ----- fulfillment -----
    const fulfillmentSection = () => {
      const date = h('input', { class: 'input', type: 'date', value: state.est_ready_date });
      date.addEventListener('input', () => { state.est_ready_date = date.value; changed(); });
      return h('section', { class: 'section' },
        h('h2', { class: 'label' }, 'Pickup or delivery'),
        segmented([{ value: 'pickup', label: 'Pickup' }, { value: 'delivery', label: 'Delivery' }], state.fulfillment,
          (v) => { state.fulfillment = v; changed(); }, 'Pickup or delivery'),
        h('p', { class: 'hint' }, 'No fee for either.'),
        h('div', { style: { marginTop: '16px' } }, field('Estimated ready date (optional)', date, 'Shown to the customer as an estimate.')));
    };

    // ----- totals -----
    const totalsSection = () => {
      const subEl = h('span', { class: 'amount' });
      const totEl = h('span', { class: 'amount' });
      const upEl = h('div', { class: 'totals-row small' });
      totalUpdaters.push(() => {
        const t = computeTotals(state.items.map((it) => ({ qty: it.qty, lines: linesInCents(it) })), parseMoney(state.discount) || 0);
        subEl.textContent = formatCents(t.subtotal_cents);
        totEl.textContent = formatCents(t.total_cents);
        const pct = parseInt(state.upfront_percent, 10);
        upEl.hidden = !(pct > 0 && pct < 100);
        setChildren(upEl, h('span', null, 'Due upfront (' + pct + '%)'), h('span', { class: 'amount' }, formatCents(upfrontCents(t.total_cents, pct))));
      });
      let discountRows;
      if (state.show_discount) {
        const label = textInput(state.discount_label, { maxlength: '100', placeholder: 'e.g. Repeat customer', 'aria-label': 'Discount description' });
        label.addEventListener('input', () => { state.discount_label = label.value; changed(); });
        const amount = moneyInput(state.discount, { 'aria-label': 'Discount amount' });
        amount.addEventListener('input', () => { state.discount = amount.value; changed(); });
        discountRows = h('div', { class: 'discount-box' },
          h('div', { class: 'totals-row' }, h('strong', null, 'Discount'),
            h('button', { type: 'button', class: 'btn-link', onclick: () => { state.show_discount = false; state.discount = ''; state.discount_label = ''; draw(); } }, 'Remove')),
          label, h('div', { class: 'line-bottom' }, h('span', { class: 'grow' }), h('span', { class: 'dollar' }, '− $'), amount));
      } else {
        discountRows = h('button', { type: 'button', class: 'btn-link', onclick: () => { state.show_discount = true; draw(); } }, '+ Add discount');
      }
      return h('section', { class: 'section card totals' },
        h('div', { class: 'totals-row' }, h('span', null, 'Subtotal'), subEl),
        discountRows,
        h('div', { class: 'totals-row grand' }, h('span', null, 'Total'), totEl),
        upEl);
    };

    // ----- notes -----
    const notesSection = () => {
      const cn = textArea(state.customer_note, { maxlength: '5000', rows: '3' });
      cn.addEventListener('input', () => { state.customer_note = cn.value; changed(); });
      const inn = textArea(state.internal_notes, { maxlength: '5000', rows: '3' });
      inn.addEventListener('input', () => { state.internal_notes = inn.value; changed(); });
      return h('section', { class: 'section' },
        field('Note to customer (optional)', cn, 'Shown on the customer\'s page.'),
        field('Internal notes (optional)', inn, 'Only you see these.'));
    };

    // ----- more options -----
    const moreOptions = () => {
      const pct = textInput(state.upfront_percent, { inputmode: 'numeric', maxlength: '3', style: { maxWidth: '120px' } });
      pct.addEventListener('input', () => { state.upfront_percent = pct.value.replace(/\D/g, ''); changed(); });
      const pctOpen = parseInt(state.upfront_percent, 10) !== 100;
      return h('details', { class: 'more-options', open: pctOpen || undefined },
        h('summary', null, 'More options'),
        field('Upfront percent', pct, 'Usually 100: paid in full at the time of order. With less, the customer sees "Due now" and a balance due when the order is ready.'));
    };

    // ----- save -----
    const saveButton = (andSend) => {
      const label = andSend ? 'Save & Send' : 'Save';
      const btn = h('button', { type: 'button', class: andSend ? 'btn' : 'btn btn-secondary' }, label);
      btn.addEventListener('click', () => withBusy(btn, 'Saving…', async () => {
        const payload = buildPayload(state);
        const res = await call('docs.save', payload);
        clearTimeout(draftTimer);
        clearDraft(key);
        toast('Saved ' + res.doc.number);
        const path = '/orders/' + encodeURIComponent(res.doc.number);
        // Save & Send opens the order page, which offers "Send now" (the share menu needs a fresh tap).
        if (andSend) navigate(path + '?send=1', { replace: true });
        // Editing: go back to the order page we came from. New: replace the editor with the order page.
        else if (state.doc_id) back(path);
        else navigate(path, { replace: true });
      }));
      return btn;
    };

    draw();
  }
};

/** Check the form and turn it into a docs.save payload. Throws friendly errors. */
function buildPayload(state) {
  if (!state.customer_id) throw new ApiError('VALIDATION', 'Please choose a customer.');
  if (!state.items.length) throw new ApiError('VALIDATION', 'Please add at least one item.');
  const items = state.items.map((it, i) => {
    const n = i + 1;
    if (!it.title.trim()) throw new ApiError('VALIDATION', 'Item ' + n + ' needs a title.');
    return {
      item_id: it.item_id, product_id: it.product_id, package_id: it.package_id, title: it.title, qty: it.qty,
      details: it.details,
      lines: it.lines.map((l, j) => {
        const where = 'Item ' + n + ', line ' + (j + 1);
        if (!l.label.trim()) throw new ApiError('VALIDATION', where + ' needs a description.');
        const cents = parseMoney(l.amount);
        if (cents === null) throw new ApiError('VALIDATION', where + ' needs an amount, like 45 or 45.00.');
        return { line_id: l.line_id, label: l.label, amount_cents: cents, kind: l.kind || 'custom', addon_id: l.addon_id || '' };
      })
    };
  });
  let discount = 0;
  if (state.show_discount && String(state.discount).trim()) {
    discount = parseMoney(state.discount);
    if (discount === null || discount < 0) throw new ApiError('VALIDATION', 'The discount needs an amount, like 25 or 25.00.');
  }
  const pct = parseInt(state.upfront_percent, 10);
  if (!(pct >= 1 && pct <= 100)) throw new ApiError('VALIDATION', 'Upfront percent must be from 1 to 100.');
  return {
    doc_id: state.doc_id || undefined, type: state.type, customer_id: state.customer_id,
    fulfillment: state.fulfillment, est_ready_date: state.est_ready_date,
    discount_cents: discount, discount_label: state.show_discount ? state.discount_label : '',
    customer_note: state.customer_note, internal_notes: state.internal_notes, upfront_percent: pct, items
  };
}

/** Add a customer without leaving the order. Checks for duplicates first. */
function newCustomerSheet(onDone) {
  sheet((close) => {
    const name = textInput('', { maxlength: '100', autocomplete: 'off', autocapitalize: 'words' });
    const phone = textInput('', { type: 'tel', inputmode: 'tel', maxlength: '30', autocomplete: 'off' });
    const email = textInput('', { type: 'email', inputmode: 'email', maxlength: '100', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const save = h('button', { type: 'submit', class: 'btn btn-block' }, 'Add customer');
    const payload = (force) => ({ name: name.value, phone: phone.value, email: email.value, notes: '', force: force || undefined });
    const finish = (c) => { upsertCustomer(c); close(); toast('Customer added'); onDone(c); };
    return h('form', { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      withBusy(save, 'Saving…', async () => {
        if (!name.value.trim()) throw new ApiError('VALIDATION', 'Please type the customer\'s name.');
        const res = await call('customers.save', payload(false));
        if (res.saved) { finish(res.customer); return; }
        close();
        askUseExisting(res.duplicates, {
          onUse: (d) => onDone(d),
          onSaveNew: async () => { const r = await call('customers.save', payload(true)); upsertCustomer(r.customer); onDone(r.customer); }
        });
      });
    } },
    h('h2', null, 'New customer'),
    field('Name', name), field('Phone', phone), field('Email', email, 'A phone or email is needed to send the link.'),
    h('div', { class: 'actions' }, save, h('button', { type: 'button', class: 'btn-link', onclick: () => close() }, 'Cancel')));
  });
}
