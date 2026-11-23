// screens/order-actions.js: sheets used on the order page: record payment (SPEC 6.6),
// reason prompts (void, cancel), change stage, and the "More" menu.
import { h, field, textInput, textArea, moneyInput, segmented, sheet, confirmDialog, withBusy, setChildren } from '../ui.js';
import { ApiError } from '../api.js';
import { formatCents, centsToInput, parseMoney } from '../money.js';

/** Today's date in Phoenix as YYYY-MM-DD. */
export function todayPhoenix() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/**
 * Record payment sheet. `save(payload)` posts it and returns the updated order.
 * Resolves with the updated order, or null if cancelled.
 */
export function recordPaymentSheet(doc, save) {
  return new Promise((resolve) => {
    let result = null;
    sheet((close) => {
      let method = 'zelle';
      const balance = Math.max(0, doc.total_cents - (doc.paid_cents || 0));
      const suggested = doc.amount_due_cents || balance;
      const amount = moneyInput(suggested ? centsToInput(suggested) : '', { 'aria-label': 'Amount' });
      const date = h('input', { class: 'input', type: 'date', value: todayPhoenix(), max: todayPhoenix() });
      const note = textInput('', { maxlength: '500', placeholder: 'Optional' });
      const btn = h('button', { type: 'submit', class: 'btn btn-block' }, 'Save payment');
      return h('form', { novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        withBusy(btn, 'Saving…', async () => {
          const cents = parseMoney(amount.value);
          if (cents === null || cents <= 0) throw new ApiError('VALIDATION', 'Please type the amount received, like 341 or 341.00.');
          if (cents > balance) {
            const ok = await confirmDialog({
              title: 'More than the balance',
              message: 'The balance is ' + formatCents(balance) + '. Record ' + formatCents(cents) + ' anyway?',
              yes: 'Record anyway'
            });
            if (!ok) return;
          }
          result = await save({ doc_id: doc.doc_id, amount_cents: cents, method, paid_on: date.value || todayPhoenix(), note: note.value });
          close();
        });
      } },
      h('h2', null, 'Record payment'),
      h('p', { class: 'muted' }, doc.number + ' · ' + (balance ? 'balance ' + formatCents(balance) : 'paid in full')),
      h('div', { class: 'field' }, h('span', null, 'Amount ($)'), amount),
      h('div', { class: 'field' }, h('span', null, 'Paid with'),
        h('div', { class: 'big-toggle' }, segmented([{ value: 'zelle', label: 'Zelle' }, { value: 'cash', label: 'Cash' }], method, (v) => { method = v; }, 'Paid with'))),
      field('Date received', date),
      field('Note', note),
      h('div', { class: 'actions' }, btn, h('button', { type: 'button', class: 'btn-link', onclick: () => close() }, 'Cancel')));
    }, { onClose: () => resolve(result) });
  });
}

/** Ask for a reason (void, cancel, void payment). Resolves with the text, or null if cancelled. */
export function reasonSheet({ title, message, label = 'Reason', yes = 'Confirm', required = true, danger = true }) {
  return new Promise((resolve) => {
    let result = null;
    sheet((close) => {
      const text = textArea('', { rows: '3', maxlength: '500' });
      const err = h('p', { class: 'error-text', role: 'alert' });
      return h('form', { novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        if (required && !text.value.trim()) { err.textContent = 'Please type a short reason.'; text.focus(); return; }
        result = text.value.trim();
        close();
      } },
      h('h2', null, title),
      message ? h('p', null, message) : null,
      field(label + (required ? '' : ' (optional)'), text),
      err,
      h('div', { class: 'actions' },
        h('button', { type: 'submit', class: 'btn btn-block' + (danger ? ' btn-danger' : '') }, yes),
        h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => close() }, 'Cancel')));
    }, { onClose: () => resolve(result) });
  });
}

const STAGES = [
  { value: 'awaiting_payment', label: 'Awaiting payment' }, { value: 'in_progress', label: 'In progress' },
  { value: 'ready', label: 'Ready' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }
];

/** Choose a stage to move to (fixing mistakes). Resolves with the stage value or null. */
export function stageSheet(current) {
  return new Promise((resolve) => {
    let result = null;
    sheet((close) => [
      h('h2', null, 'Change stage'),
      h('p', { class: 'muted' }, 'Use this to fix a mistake. Normally the stage moves by itself as you work.'),
      h('ul', { class: 'list' }, STAGES.map((s) => h('li', null,
        h('button', { type: 'button', class: 'list-row button-row' + (s.value === current ? ' selected' : ''), disabled: s.value === current,
          onclick: () => { result = s.value; close(); } },
        h('span', { class: 'grow' }, s.label), s.value === current ? h('span', { class: 'small muted' }, 'Now') : null)))),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => close() }, 'Cancel'))
    ], { onClose: () => resolve(result) });
  });
}

/** "More" menu: a list of [label, handler, {danger}] rows. */
export function moreSheet(title, rows) {
  sheet((close) => {
    const list = h('ul', { class: 'list' });
    setChildren(list, rows.filter(Boolean).map(([label, fn, opts = {}]) => h('li', null,
      h('button', { type: 'button', class: 'list-row button-row' + (opts.danger ? ' danger-row' : ''), onclick: () => { close(); setTimeout(fn, 0); } },
        h('span', { class: 'grow' }, label)))));
    return [h('h2', null, title), list,
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => close() }, 'Close'))];
  });
}

/** Offer a follow-up message after an action (receipt, ready). The tap on "Send" opens the share menu. */
export function offerSheet({ title, message, yes, onYes }) {
  sheet((close) => [
    h('h2', null, title),
    h('p', null, message),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-block', onclick: () => { close(); onYes(); } }, yes),
      h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: () => close() }, 'Not now'))
  ]);
}
