// tracking.js: profit tracking pieces shared by the order screen and the Profit screen.
// Costs (money spent), time worked, and the "Costs & time" section on an order.
// Only Terri sees any of this; it never appears on the customer page.
import { h, field, textInput, selectInput, moneyInput, sheet, confirmDialog, toast, withBusy, setChildren } from './ui.js';
import { call, ApiError } from './api.js';
import { store } from './store.js';
import { formatCents, centsToInput, parseMoney } from './money.js';

export const COST_CATEGORIES = [
  { value: 'jacket', label: 'Jacket or garment' },
  { value: 'fabric', label: 'Fabric and lining' },
  { value: 'patches', label: 'Patches' },
  { value: 'supplies', label: 'Supplies (thread, zippers, paint)' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'other', label: 'Other' }
];

export function categoryLabel(value) {
  const c = COST_CATEGORIES.find((x) => x.value === value);
  return c ? c.label : 'Other';
}

/** Short label for lists: "Supplies" instead of "Supplies (thread, zippers, paint)". */
export function categoryShort(value) {
  return categoryLabel(value).replace(/ \(.*\)$/, '');
}

/** Today in Phoenix as YYYY-MM-DD (for date boxes). */
export function todayYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' });
}

/** "2026-11-21" -> "Nov 21" (adds the year if it isn't this year). */
export function shortDay(ymd) {
  if (!ymd) return '';
  const d = new Date(ymd + 'T12:00:00-07:00');
  if (isNaN(d)) return ymd;
  const sameYear = ymd.slice(0, 4) === todayYmd().slice(0, 4);
  return d.toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric', timeZone: 'America/Phoenix' }, sameYear ? {} : { year: 'numeric' }));
}

/** 150 -> "2 h 30 min", 45 -> "45 min", 0 -> "0 h". */
export function formatMinutes(m) {
  m = Math.round(Number(m) || 0);
  const hrs = Math.floor(m / 60);
  const mins = m % 60;
  if (!m) return '0 h';
  return [hrs ? hrs + ' h' : '', mins ? mins + ' min' : ''].filter(Boolean).join(' ');
}

/** 2000 -> "$20/h", 2550 -> "$25.50/h". */
export function formatRate(cents) {
  return formatCents(cents).replace(/\.00$/, '') + '/h';
}

export function workTasks() {
  const raw = (store.data && store.data.settings.work_tasks) || 'Sewing\nOther';
  return raw.split('\n').map((t) => t.trim()).filter(Boolean);
}

export function hourlyRate() {
  const r = Number(store.data && store.data.settings.hourly_rate_cents);
  return r >= 0 ? r : 2000;
}

function dateInput(value) {
  return h('input', { class: 'input', type: 'date', value: value || todayYmd(), max: '2099-12-31', style: { maxWidth: '220px' } });
}

function numberBox(value, props = {}) {
  return textInput(value, Object.assign({ inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: '3', style: { maxWidth: '110px' } }, props));
}

/* ---------- add / edit a cost ---------- */

/**
 * Bottom sheet to add or edit a cost. `docId` blank = general cost (not for one order).
 * Resolves with the server result ({ cost, tracking }), { deleted: true, tracking }, or null.
 */
export function costSheet({ cost = null, docId = '', orderNumber = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    sheet((close) => {
      const category = selectInput(COST_CATEGORIES, cost ? cost.category : 'jacket');
      const description = textInput(cost ? cost.description : '', { maxlength: '200', autocomplete: 'off', placeholder: 'e.g. Black bomber, size L' });
      const supplier = textInput(cost ? cost.supplier : '', { maxlength: '100', autocomplete: 'off', placeholder: 'e.g. Amazon, patch maker' });
      const qty = numberBox(cost ? String(cost.qty) : '1');
      const each = moneyInput(cost ? centsToInput(cost.each_cents) : '');
      const date = dateInput(cost ? cost.spent_on : '');
      const total = h('strong', { class: 'amount' });
      const update = () => {
        const n = parseInt(qty.value, 10) || 0;
        const c = parseMoney(each.value);
        total.textContent = c === null ? '—' : formatCents(c * n);
      };
      qty.addEventListener('input', update);
      each.addEventListener('input', update);
      update();

      const save = h('button', { type: 'submit', class: 'btn btn-block' }, cost ? 'Save cost' : 'Add cost');
      const form = h('form', { novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        withBusy(save, 'Saving…', async () => {
          const n = Number(qty.value);
          const c = parseMoney(each.value);
          if (!Number.isInteger(n) || n < 1 || n > 999) throw new ApiError('VALIDATION', 'How many must be a whole number from 1 to 999.');
          if (c === null || c < 0) throw new ApiError('VALIDATION', 'Please type what it cost, like 38 or 12.50.');
          result = await call('costs.save', {
            cost_id: cost ? cost.cost_id : undefined, doc_id: cost ? undefined : docId,
            category: category.value, description: description.value, supplier: supplier.value,
            qty: n, each_cents: c, spent_on: date.value
          });
          toast(cost ? 'Cost saved' : 'Cost added');
          close();
        });
      } },
      h('h2', null, cost ? 'Edit cost' : (docId ? 'Add a cost' + (orderNumber ? ' to ' + orderNumber : '') : 'Add a general cost')),
      !docId && !cost ? h('p', { class: 'small muted' }, 'For spending that isn\'t for one order, like patch stock, thread or tools.') : null,
      cost && cost.auto ? h('p', { class: 'small muted' }, 'Filled in from the package\'s typical costs. Change it to what you really paid.') : null,
      field('Category', category),
      field('What it was (optional)', description),
      h('div', { class: 'cost-qty-row' }, field('How many', qty), field('Cost each', each)),
      h('div', { class: 'totals-row', style: { marginBottom: '16px' } }, h('span', null, 'Total'), total),
      field('Where from (optional)', supplier),
      field('Date bought', date),
      h('div', { class: 'actions' }, save,
        cost ? h('button', { type: 'button', class: 'btn btn-danger btn-block', onclick: async () => {
          if (!(await confirmDialog({ title: 'Delete this cost?', message: formatCents(cost.amount_cents) + ' · ' + categoryShort(cost.category) + (cost.description ? ' · ' + cost.description : ''), yes: 'Delete', danger: true }))) return;
          try {
            const r = await call('costs.delete', { cost_id: cost.cost_id });
            result = { deleted: true, tracking: r.tracking };
            toast('Cost deleted');
            close();
          } catch (err) { toast(err.message || 'Something went wrong.', { error: true }); }
        } }, 'Delete cost') : null,
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => close() }, 'Cancel')));
      return form;
    }, { onClose: () => resolve(result) });
  });
}

/* ---------- add / edit time ---------- */

/** Bottom sheet to add or edit time worked on an order. Resolves { tracking } or null. */
export function timeSheet({ entry = null, docId = '', orderNumber = '' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    sheet((close) => {
      const tasks = workTasks();
      if (entry && !tasks.includes(entry.task)) tasks.push(entry.task);
      const task = selectInput(tasks.map((t) => ({ value: t, label: t })), entry ? entry.task : tasks[0]);
      const hours = numberBox(entry ? String(Math.floor(entry.minutes / 60)) : '', { placeholder: '0', maxlength: '2', 'aria-label': 'Hours' });
      const mins = numberBox(entry ? String(entry.minutes % 60) : '', { placeholder: '0', maxlength: '2', 'aria-label': 'Minutes' });
      const date = dateInput(entry ? entry.worked_on : '');
      const note = textInput(entry ? entry.note : '', { maxlength: '500', autocomplete: 'off' });
      const save = h('button', { type: 'submit', class: 'btn btn-block' }, entry ? 'Save time' : 'Add time');
      const quick = h('div', { class: 'quick-times' }, [[30, '30 min'], [60, '1 h'], [90, '1½ h'], [120, '2 h'], [180, '3 h']].map(([m, label]) =>
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { hours.value = String(Math.floor(m / 60)); mins.value = String(m % 60); } }, label)));
      const form = h('form', { novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        withBusy(save, 'Saving…', async () => {
          const hv = hours.value.trim() === '' ? 0 : Number(hours.value);
          const mv = mins.value.trim() === '' ? 0 : Number(mins.value);
          if (!Number.isInteger(hv) || !Number.isInteger(mv) || hv < 0 || mv < 0 || mv > 59) {
            throw new ApiError('VALIDATION', 'Type whole hours and minutes (minutes 0 to 59).');
          }
          const total = hv * 60 + mv;
          if (total < 1 || total > 1440) throw new ApiError('VALIDATION', 'Time worked must be from 1 minute to 24 hours.');
          result = await call('time.save', {
            time_id: entry ? entry.time_id : undefined, doc_id: entry ? undefined : docId,
            task: task.value, minutes: total, worked_on: date.value, note: note.value
          });
          toast(entry ? 'Time saved' : 'Time added');
          close();
        });
      } },
      h('h2', null, entry ? 'Edit time' : 'Add time' + (orderNumber ? ' to ' + orderNumber : '')),
      field('Task', task),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Time worked'),
        h('div', { class: 'hours-row' },
          hours, h('span', { 'aria-hidden': 'true' }, 'h'), mins, h('span', { 'aria-hidden': 'true' }, 'min')),
        quick),
      field('Date', date),
      field('Note (optional)', note),
      h('div', { class: 'actions' }, save,
        entry ? h('button', { type: 'button', class: 'btn btn-danger btn-block', onclick: async () => {
          if (!(await confirmDialog({ title: 'Delete this time?', message: formatMinutes(entry.minutes) + ' · ' + entry.task + ' · ' + shortDay(entry.worked_on), yes: 'Delete', danger: true }))) return;
          try {
            result = await call('time.delete', { time_id: entry.time_id });
            toast('Time deleted');
            close();
          } catch (err) { toast(err.message || 'Something went wrong.', { error: true }); }
        } }, 'Delete time') : null,
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => close() }, 'Cancel')));
      return form;
    }, { onClose: () => resolve(result) });
  });
}

/* ---------- "Costs & time" section on an order ---------- */

/** Profit amount with a "loss" style when below zero. */
export function profitAmount(cents, extraClass = '') {
  return h('span', { class: 'amount ' + extraClass + (cents < 0 ? ' loss' : '') }, formatCents(cents));
}

/**
 * The order screen's private section. `res` is the docs.get result; `onTracking(tracking)`
 * is called after any change so the screen can redraw.
 */
export function trackingSection(res, onTracking) {
  const d = res.doc;
  const t = res.tracking;
  if (d.type !== 'invoice' || !t || d.status === 'void') return null;

  const addCost = async () => {
    const r = await costSheet({ docId: d.doc_id, orderNumber: d.number });
    if (r && r.tracking) onTracking(r.tracking);
  };
  const editCost = async (c) => {
    const r = await costSheet({ cost: c });
    if (r && r.tracking) onTracking(r.tracking);
  };
  const addTime = async () => {
    const r = await timeSheet({ docId: d.doc_id, orderNumber: d.number });
    if (r && r.tracking) onTracking(r.tracking);
  };
  const editTime = async (e) => {
    const r = await timeSheet({ entry: e });
    if (r && r.tracking) onTracking(r.tracking);
  };

  const row = (label, value, cls = '') => h('div', { class: 'totals-row ' + cls }, h('span', null, label), value);
  const charged = d.stage === 'cancelled' ? 'Kept (order cancelled)' : 'Charged';

  return h('section', { class: 'section' },
    h('h2', { class: 'label' }, 'Costs & time'),
    h('div', { class: 'card profit-card' },
      row(charged, h('span', { class: 'amount' }, formatCents(t.income_cents))),
      row('Spent', h('span', { class: 'amount' }, '−' + formatCents(t.spent_cents))),
      row('Profit', profitAmount(t.profit_cents), 'grand'),
      t.minutes ? row('Your time: ' + formatMinutes(t.minutes) + ' at ' + formatRate(t.hourly_rate_cents), h('span', { class: 'amount' }, '−' + formatCents(t.labor_cents))) : null,
      t.minutes ? row('Profit after paying yourself', profitAmount(t.profit_after_labor_cents), 'strong') : null,
      t.minutes ? h('p', { class: 'small muted', style: { margin: '8px 0 0' } }, 'You earned ' + formatCents(Math.round(t.profit_cents * 60 / t.minutes)) + ' an hour on this order.') : null),

    h('h3', { class: 'needs-title' }, 'Costs'),
    t.costs.length ? h('ul', { class: 'list' }, t.costs.map((c) => h('li', null,
      h('button', { type: 'button', class: 'list-row row-button', onclick: () => editCost(c), 'aria-label': 'Edit cost: ' + categoryShort(c.category) + ' ' + formatCents(c.amount_cents) },
        h('div', { class: 'grow' },
          h('div', null, categoryShort(c.category) + (c.description ? ' · ' + c.description : '')),
          h('div', { class: 'small muted' }, [c.qty > 1 ? c.qty + ' × ' + formatCents(c.each_cents) : null, c.supplier || null, shortDay(c.spent_on), c.auto ? 'typical cost' : null].filter(Boolean).join(' · '))),
        h('span', { class: 'amount' }, formatCents(c.amount_cents))))))
      : h('p', { class: 'muted small' }, 'No costs yet. Add what you spent on this order: the jacket, fabric, patches, supplies, shipping.'),
    h('button', { type: 'button', class: 'btn btn-secondary btn-block', style: { marginTop: '10px' }, onclick: addCost }, '+ Add cost'),

    h('h3', { class: 'needs-title' }, 'Time worked'),
    t.time.length ? h('ul', { class: 'list' }, t.time.map((e) => h('li', null,
      h('button', { type: 'button', class: 'list-row row-button', onclick: () => editTime(e), 'aria-label': 'Edit time: ' + e.task + ' ' + formatMinutes(e.minutes) },
        h('div', { class: 'grow' },
          h('div', null, e.task),
          h('div', { class: 'small muted' }, [shortDay(e.worked_on), e.note || null].filter(Boolean).join(' · '))),
        h('span', { class: 'amount' }, formatMinutes(e.minutes))))))
      : h('p', { class: 'muted small' }, 'No time logged yet.'),
    h('button', { type: 'button', class: 'btn btn-secondary btn-block', style: { marginTop: '10px' }, onclick: addTime }, '+ Add time'),
    h('p', { class: 'small muted', style: { marginTop: '10px' } }, 'Only you see this. Customers never do.'));
}

/* ---------- typical costs editor (package screen) ---------- */

/**
 * Editor for a package's typical costs. Returns { el, collect() } where collect() returns
 * the list to save (or throws a friendly error).
 */
export function typicalCostsEditor(initial) {
  const rows = (initial || []).map((c) => ({ category: c.category, description: c.description, amount: centsToInput(c.amount_cents) }));
  const list = h('div', { class: 'line-editor' });
  const totalEl = h('span', { class: 'amount' });
  const updateTotal = () => { totalEl.textContent = formatCents(rows.reduce((t, r) => t + (parseMoney(r.amount) || 0), 0)); };
  const draw = () => {
    setChildren(list, rows.map((r, i) => {
      const n = i + 1;
      const cat = selectInput(COST_CATEGORIES, r.category, { 'aria-label': 'Typical cost ' + n + ' category' });
      cat.addEventListener('change', () => { r.category = cat.value; });
      const desc = textInput(r.description, { maxlength: '200', autocomplete: 'off', placeholder: 'e.g. Bomber jacket blank', 'aria-label': 'Typical cost ' + n + ' description' });
      desc.addEventListener('input', () => { r.description = desc.value; });
      const amt = moneyInput(r.amount, { 'aria-label': 'Typical cost ' + n + ' amount' });
      amt.addEventListener('input', () => { r.amount = amt.value; updateTotal(); });
      const del = h('button', { type: 'button', class: 'icon-btn danger', 'aria-label': 'Remove typical cost ' + n, title: 'Remove', onclick: () => { rows.splice(i, 1); draw(); } }, '✕');
      return h('div', { class: 'line-card' }, cat, desc,
        h('div', { class: 'line-bottom' }, h('span', { class: 'dollar', 'aria-hidden': 'true' }, '$'), amt, h('span', { class: 'grow' }), del));
    }));
    if (!rows.length) list.append(h('p', { class: 'muted small' }, 'None yet. New orders with this package start with no costs.'));
    updateTotal();
  };
  draw();
  const add = h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => {
    rows.push({ category: rows.length ? 'fabric' : 'jacket', description: '', amount: '' });
    draw();
    const inputs = list.querySelectorAll('.line-card input:not(.money)');
    if (inputs.length) inputs[inputs.length - 1].focus();
  } }, '+ Add typical cost');
  const el = h('div', null, list, h('div', { class: 'line-total' }, h('span', null, 'Typical cost per item'), totalEl), h('div', { class: 'section' }, add));
  return {
    el,
    collect() {
      return rows.map((r, i) => {
        const cents = parseMoney(r.amount);
        if (cents === null || cents < 0) throw new ApiError('VALIDATION', 'Typical cost ' + (i + 1) + ' needs an amount, like 38 or 12.50.');
        return { category: r.category, description: r.description.trim(), amount_cents: cents };
      });
    }
  };
}
