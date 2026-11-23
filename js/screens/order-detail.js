// screens/order-detail.js: one quote or invoice (SPEC 6.5). Header with status and flags,
// actions that depend on the state (send, record payment, mark ready, picked up, convert...),
// progress checklist per item, payments, items and details, and the activity timeline.
import { h, formatDate, formatDateTime, setChildren, confirmDialog, toast, showError, copyToClipboard, showTextToCopy } from '../ui.js';
import { call } from '../api.js';
import { store, upsertCustomer } from '../store.js';
import { navigate } from '../router.js';
import { formatCents } from '../money.js';
import { INCLUDED_SPOTS, extraLabel } from '../rules.js';
import { statusBadges } from './orders.js';
import { sendMessage, recordShared, customerLink } from '../share.js';
import { recordPaymentSheet, reasonSheet, stageSheet, moreSheet, offerSheet } from './order-actions.js';

export { customerLink };

const ACTIVITY = {
  created: 'Created', sent: 'Sent', viewed: 'Viewed by customer', approved: 'Approved', declined: 'Declined',
  converted: 'Became an invoice', payment: 'Payment recorded', payment_void: 'Payment voided', stage: 'Stage changed',
  void: 'Voided', renewed: 'Renewed'
};

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'the customer';
}

export default {
  title: (p) => p.number,
  tab: 'orders',
  back: true,
  async render(main, params, view) {
    let res = null;
    let offeredSend = false;
    setChildren(main, h('div', { class: 'spinner', 'aria-label': 'Loading' }));

    const apply = (next) => {
      if (!next || !view.isCurrent()) return;
      res = next;
      if (res.customer) upsertCustomer(res.customer);
      draw();
    };
    const load = async () => apply(await call('docs.get', { number: params.number }));
    const run = async (action, payload, okText) => {
      try {
        const next = await call(action, payload);
        if (okText) toast(okText);
        return next;
      } catch (err) {
        showError(err);
        return null;
      }
    };

    /* ----- actions ----- */
    const settings = () => store.data.settings;
    const send = (kind) => sendMessage({
      kind, doc: res.doc, customer: res.customer, settings: settings(),
      onSent: async () => apply(await recordShared(res.doc))
    });

    const recordPayment = async () => {
      const next = await recordPaymentSheet(res.doc, (payload) => call('payments.add', payload));
      if (!next) return;
      apply(next);
      toast('Payment recorded');
      offerSheet({
        title: 'Send a receipt?',
        message: 'The same link now shows the payment. Send it to ' + firstName(res.customer && res.customer.name) + ' as a receipt?',
        yes: 'Send receipt', onYes: () => send('receipt')
      });
    };

    const markReady = async () => {
      const next = await run('docs.setStage', { doc_id: res.doc.doc_id, stage: 'ready' }, 'Marked ready');
      if (!next) return;
      apply(next);
      offerSheet({
        title: 'Let ' + firstName(res.customer && res.customer.name) + ' know?',
        message: 'Send a message that the order is ready' + (res.doc.fulfillment === 'delivery' ? ' and you\'ll arrange delivery.' : ' for pickup.'),
        yes: 'Send message', onYes: () => send('ready')
      });
    };

    const complete = async () => {
      const d = res.doc;
      const balance = d.total_cents - (d.paid_cents || 0);
      const word = d.fulfillment === 'delivery' ? 'delivered' : 'picked up';
      const ok = await confirmDialog(balance > 0
        ? { title: 'There\'s still a balance', message: formatCents(balance) + ' is still unpaid. Mark ' + d.number + ' as ' + word + ' and completed anyway?', yes: 'Mark completed' }
        : { title: 'Mark as ' + word + '?', message: d.number + ' will be marked completed.', yes: 'Yes, ' + word });
      if (!ok) return;
      apply(await run('docs.setStage', { doc_id: d.doc_id, stage: 'completed' }, 'Order completed'));
    };

    const convert = async (approved) => {
      const ok = await confirmDialog(approved
        ? { title: 'Mark approved?', message: 'For approvals by phone or in person. This makes the invoice for this quote; you then send it.', yes: 'Mark approved' }
        : { title: 'Convert to invoice?', message: 'This makes a new invoice from the quote. You can edit it before sending.', yes: 'Convert' });
      if (!ok) return;
      const inv = await run(approved ? 'docs.markApproved' : 'docs.convertToInvoice', { doc_id: res.doc.doc_id }, 'Invoice created');
      if (inv) navigate('/orders/' + encodeURIComponent(inv.doc.number));
    };

    const markSent = async () => {
      const ok = await confirmDialog({
        title: 'Mark as sent?',
        message: 'Use this when you sent the link yourself, outside the app.' + (res.doc.type === 'quote' ? ' The quote can be approved for the next 30 days.' : ''),
        yes: 'Mark as sent'
      });
      if (ok) apply(await run('docs.markSent', { doc_id: res.doc.doc_id, method: 'manual' }, 'Marked as sent'));
    };

    const copyLink = async () => {
      if (await copyToClipboard(customerLink(res.doc))) toast('Link copied');
      else showTextToCopy('Copy this link', customerLink(res.doc));
    };

    const changeStage = async () => {
      const stage = await stageSheet(res.doc.stage);
      if (!stage) return;
      if (stage === 'cancelled') { cancelOrder(); return; }
      const ok = await confirmDialog({ title: 'Change stage?', message: 'Move ' + res.doc.number + ' to "' + stage.replace('_', ' ') + '"?', yes: 'Change stage' });
      if (ok) apply(await run('docs.setStage', { doc_id: res.doc.doc_id, stage }, 'Stage changed'));
    };

    const cancelOrder = async () => {
      const reason = await reasonSheet({ title: 'Cancel ' + res.doc.number + '?', message: 'The order stays in your records as cancelled.', yes: 'Cancel order' });
      if (reason) apply(await run('docs.setStage', { doc_id: res.doc.doc_id, stage: 'cancelled', reason }, 'Order cancelled'));
    };

    const voidDoc = async () => {
      const reason = await reasonSheet({ title: 'Void ' + res.doc.number + '?', message: 'The customer\'s link stops working. The number is not reused. This can\'t be undone.', yes: 'Void' });
      if (reason) apply(await run('docs.void', { doc_id: res.doc.doc_id, reason }, 'Voided'));
    };

    const renew = async () => apply(await run('docs.renewQuote', { doc_id: res.doc.doc_id }, 'Quote renewed for 30 days'));

    const duplicate = async () => {
      const ok = await confirmDialog({ title: 'Duplicate ' + res.doc.number + '?', message: 'Makes a new draft with the same customer and items.', yes: 'Duplicate' });
      if (!ok) return;
      const copy = await run('docs.duplicate', { doc_id: res.doc.doc_id }, 'Copy created');
      if (copy) navigate('/orders/' + encodeURIComponent(copy.doc.number) + '/edit');
    };

    const voidPayment = async (pmt) => {
      const reason = await reasonSheet({
        title: 'Void this payment?', message: formatCents(pmt.amount_cents) + ' ' + (pmt.method === 'zelle' ? 'Zelle' : 'cash') + ' on ' + formatDate(pmt.paid_on + 'T12:00:00-07:00') + '. It stays in the records, marked void.',
        yes: 'Void payment', required: false
      });
      if (reason !== null) apply(await run('payments.void', { payment_id: pmt.payment_id, reason }, 'Payment voided'));
    };

    const toggleStep = async (item, step) => {
      const done = !step.done_at;
      step.done_at = done ? new Date().toISOString() : '';
      draw();
      const next = await run('checklist.toggle', { doc_id: res.doc.doc_id, item_id: item.item_id, step_no: step.step_no, done });
      if (!next) { await load(); return; }
      apply(next);
      if (!done) return;
      const all = (which) => res.progress.every((p) => (which === 'final' ? p.steps[p.final_step - 1] : p.steps[p.steps.length - 1]).done_at);
      if (step.step_no === item.final_step && res.doc.stage === 'in_progress' && all('final')) {
        if (await confirmDialog({ title: 'Mark order Ready?', message: 'Every item has passed final check.', yes: 'Mark ready', no: 'Not yet' })) markReady();
      } else if (step.step_no === item.steps.length && res.doc.stage === 'ready' && all('last')) {
        if (await confirmDialog({ title: 'Mark order Completed?', message: 'Every item is picked up or delivered.', yes: 'Mark completed', no: 'Not yet' })) complete();
      }
    };

    /* ----- drawing ----- */
    const actionButtons = () => {
      const d = res.doc;
      const isQuote = d.type === 'quote';
      const status = d.effective_status;
      const hasItems = res.items.length > 0;
      const editable = d.status !== 'void' && d.status !== 'converted';
      const primary = [];
      const secondary = [];
      const btn = (label, fn, cls = 'btn btn-secondary') => h('button', { type: 'button', class: cls, onclick: fn }, label);

      if (isQuote) {
        if (status === 'converted' && d.converted_invoice_number) {
          primary.push(h('a', { class: 'btn btn-block', href: '#/orders/' + encodeURIComponent(d.converted_invoice_number) }, 'Open invoice ' + d.converted_invoice_number));
        }
        if ((status === 'draft' || status === 'sent') && hasItems) {
          if (!d.sent_at) primary.push(btn('Send quote', () => send('quote'), 'btn btn-block'));
          else secondary.push(btn('Resend', () => send('quote')));
        }
        if (status === 'expired') primary.push(btn('Renew quote', renew, 'btn btn-block'));
        if (status === 'sent') secondary.push(btn('Mark approved', () => convert(true)));
        if (['draft', 'sent', 'approved', 'declined', 'expired'].includes(status) && hasItems) secondary.push(btn('Convert to invoice', () => convert(false)));
      } else if (d.status !== 'void') {
        const cancelled = d.stage === 'cancelled';
        if (!d.sent_at && hasItems && !cancelled) primary.push(btn('Send invoice', () => send('invoice'), 'btn btn-block'));
        if (!cancelled && d.total_cents - (d.paid_cents || 0) > 0) {
          const main = d.sent_at && d.stage === 'awaiting_payment';
          (main ? primary : secondary).push(btn('Record payment', recordPayment, main ? 'btn btn-block' : 'btn btn-secondary'));
        }
        if (d.stage === 'in_progress') primary.push(btn('Mark ready', markReady, 'btn btn-block'));
        if (d.stage === 'ready') {
          primary.push(btn(d.fulfillment === 'delivery' ? 'Delivered' : 'Picked up', complete, 'btn btn-block'));
          secondary.push(btn('Send "ready" message', () => send('ready')));
        }
        if (d.sent_at && !cancelled) secondary.push(btn('Resend', () => send('invoice')));
      }
      secondary.push(h('a', { class: 'btn btn-secondary', href: customerLink(d, true), target: '_blank', rel: 'noopener', 'aria-label': 'Preview as customer' }, 'Preview'));
      secondary.push(btn('More…', () => moreMenu(editable, hasItems)));
      return h('div', { class: 'section stack' }, primary, h('div', { class: 'item-buttons' }, secondary));
    };

    const moreMenu = (editable, hasItems) => {
      const d = res.doc;
      const isQuote = d.type === 'quote';
      moreSheet(d.number, [
        editable ? ['Edit', () => navigate('/orders/' + encodeURIComponent(d.number) + '/edit')] : null,
        ['Duplicate', duplicate],
        editable && hasItems && !d.sent_at ? ['Mark as sent', markSent] : null,
        d.status !== 'void' ? ['Copy customer link', copyLink] : null,
        !isQuote && (d.paid_cents || 0) > 0 ? ['Send receipt', () => send('receipt')] : null,
        isQuote && d.effective_status === 'declined' ? ['Renew quote', renew] : null,
        !isQuote && d.status !== 'void' ? ['Change stage', changeStage] : null,
        !isQuote && d.status !== 'void' && d.stage !== 'cancelled' ? ['Cancel order', cancelOrder, { danger: true }] : null,
        d.status !== 'void' && d.status !== 'converted' ? ['Void', voidDoc, { danger: true }] : null
      ]);
    };

    const progressSection = () => {
      if (res.doc.type !== 'invoice' || !res.progress.length || res.doc.status === 'void') return null;
      return h('section', { class: 'section' },
        h('h2', { class: 'label' }, 'Progress'),
        res.progress.map((item) => h('div', { class: 'card progress-card' },
          res.progress.length > 1 ? h('strong', null, item.title) : null,
          h('ol', { class: 'checklist' }, item.steps.map((s) => h('li', null,
            h('button', { type: 'button', class: 'check' + (s.done_at ? ' done' : ''), 'aria-pressed': String(!!s.done_at), onclick: () => toggleStep(item, s) },
              h('span', { class: 'box', 'aria-hidden': 'true' }, s.done_at ? '✓' : ''),
              h('span', { class: 'grow' }, h('span', null, s.step_no + '. ' + s.label),
                s.done_at ? h('span', { class: 'small muted' }, formatDate(s.done_at).replace(/, \d{4}$/, '')) : null))))))));
    };

    const paymentsSection = () => {
      const d = res.doc;
      if (d.type !== 'invoice') return null;
      const pays = res.payments;
      return h('section', { class: 'section' },
        h('h2', { class: 'label' }, 'Payments'),
        pays.length ? h('ul', { class: 'list' }, pays.map((p) => h('li', { class: p.voided ? 'muted-row' : '' },
          h('div', { class: 'list-row' },
            h('div', { class: 'grow' },
              h('div', null, (p.method === 'zelle' ? 'Zelle' : 'Cash') + ' · ' + formatDate(p.paid_on + 'T12:00:00-07:00') + (p.voided ? ' (void)' : '')),
              p.note ? h('div', { class: 'small muted' }, p.note) : null),
            h('span', { class: 'amount' + (p.voided ? ' struck' : '') }, formatCents(p.amount_cents)),
            p.voided || d.status === 'void' ? null : h('button', { type: 'button', class: 'btn-link danger-link', onclick: () => voidPayment(p) }, 'Void')))))
          : h('p', { class: 'muted' }, 'No payments yet.'),
        d.paid_cents > d.total_cents ? h('p', { class: 'note-warn' }, 'Paid ' + formatCents(d.paid_cents - d.total_cents) + ' more than the total.') : null);
    };

    const activitySection = () => res.log.length ? h('section', { class: 'section' },
      h('h2', { class: 'label' }, 'Activity'),
      h('ul', { class: 'timeline' }, res.log.map((l) => h('li', null,
        h('div', null, h('strong', null, ACTIVITY[l.action] || l.action), l.detail ? ' · ' + l.detail : ''),
        h('div', { class: 'small muted' }, formatDateTime(l.ts)))))) : null;

    const draw = () => {
      const d = res.doc;
      const c = res.customer;
      const isQuote = d.type === 'quote';
      view.setTitle((isQuote ? 'Quote ' : 'Invoice ') + d.number);
      const balance = d.total_cents - (d.paid_cents || 0);
      setChildren(main,
        d.status === 'void' ? h('div', { class: 'note-warn' }, h('p', null, 'Void' + (d.void_reason ? ': ' + d.void_reason : '') + '. The customer\'s link no longer works.')) : null,
        d.stage === 'cancelled' && d.status !== 'void' ? h('div', { class: 'note-warn' }, h('p', null, 'Cancelled' + (d.void_reason ? ': ' + d.void_reason : '') + '.')) : null,
        h('section', { class: 'card' },
          h('div', { class: 'badges' }, statusBadges(d)),
          h('h2', { style: { margin: '10px 0 4px' } }, c ? h('a', { href: '#/customers/' + encodeURIComponent(c.customer_id), style: { color: 'inherit' } }, c.name) : 'No customer'),
          h('div', { class: 'small muted' }, 'Created ' + formatDate(d.created_at),
            d.from_quote_number ? [' · from ', h('a', { href: '#/orders/' + encodeURIComponent(d.from_quote_number) }, 'quote ' + d.from_quote_number)] : null),
          h('div', { class: 'totals-row grand', style: { marginTop: '12px' } }, h('span', null, 'Total'), h('span', { class: 'amount' }, formatCents(d.total_cents))),
          !isQuote && d.paid_cents ? h('div', { class: 'totals-row' }, h('span', null, 'Paid'), h('span', { class: 'amount' }, formatCents(d.paid_cents))) : null,
          !isQuote && d.status !== 'void' && d.stage !== 'cancelled' && balance > 0
            ? h('div', { class: 'totals-row' }, h('strong', null, d.amount_due_cents ? 'Due now' : 'Balance (due when ready)'),
              h('strong', { class: 'amount' }, formatCents(d.amount_due_cents || balance))) : null),

        actionButtons(),

        h('div', { class: 'section small muted' },
          d.sent_at ? h('p', null, 'Sent ' + formatDateTime(d.sent_at) + (d.sent_method === 'customer_approved' ? ' (customer approved the quote)' : '')) : null,
          isQuote && d.expires_at && d.effective_status === 'sent' ? h('p', null, 'Can be approved until ' + formatDate(d.expires_at)) : null,
          d.first_viewed_at ? h('p', null, 'Viewed ' + formatDateTime(d.first_viewed_at) + (d.view_count > 1 ? ' · opened ' + d.view_count + ' times' : '')) : null,
          d.approved_at ? h('p', null, 'Approved' + (d.approved_name ? ' by ' + d.approved_name : '') + ' on ' + formatDateTime(d.approved_at)) : null,
          d.declined_at ? h('p', null, 'Declined ' + formatDateTime(d.declined_at) + (d.decline_note ? ': "' + d.decline_note + '"' : '')) : null),

        progressSection(),
        paymentsSection(),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Items'),
          res.items.length ? res.items.map((it) => itemView(it)) : h('p', { class: 'muted' }, 'No items yet.')),

        h('section', { class: 'section card totals' },
          h('div', { class: 'totals-row' }, h('span', null, 'Subtotal'), h('span', { class: 'amount' }, formatCents(d.subtotal_cents))),
          d.discount_cents ? h('div', { class: 'totals-row' }, h('span', null, 'Discount' + (d.discount_label ? ' (' + d.discount_label + ')' : '')),
            h('span', { class: 'amount' }, '−' + formatCents(d.discount_cents))) : null,
          h('div', { class: 'totals-row grand' }, h('span', null, 'Total'), h('span', { class: 'amount' }, formatCents(d.total_cents)))),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Pickup or delivery'),
          h('p', null, (d.fulfillment === 'delivery' ? 'Delivery' : 'Pickup') +
            (d.est_ready_date ? ' · ready about ' + formatDate(d.est_ready_date + 'T12:00:00-07:00') + ' (estimate)' : ''))),

        d.customer_note ? h('section', { class: 'section' }, h('h2', { class: 'label' }, 'Note to customer'), h('p', { class: 'card notes' }, d.customer_note)) : null,
        d.internal_notes ? h('section', { class: 'section' }, h('h2', { class: 'label' }, 'Internal notes'), h('p', { class: 'card notes' }, d.internal_notes)) : null,
        activitySection());

      // Coming from "Save & Send": offer to send now (a fresh tap opens the share menu).
      if (params.query.send === '1' && !offeredSend) {
        offeredSend = true;
        history.replaceState(null, '', '#/orders/' + encodeURIComponent(d.number));
        if (res.items.length && d.status !== 'void') {
          offerSheet({ title: 'Send ' + d.number + ' now?', message: 'Opens your share menu to text or email the link to ' + firstName(c && c.name) + '.',
            yes: 'Send now', onYes: () => send(d.type) });
        }
      }
    };

    await load();
    return load;
  }
};

function itemView(it) {
  const unit = it.lines.reduce((t, l) => t + l.amount_cents, 0);
  return h('div', { class: 'card item-view' },
    h('div', { class: 'totals-row' }, h('strong', null, it.title + (it.qty > 1 ? ' × ' + it.qty : '')), h('span', { class: 'amount' }, formatCents(unit * it.qty))),
    h('ul', { class: 'line-list' }, it.lines.map((l) => h('li', null, h('span', null, l.label), h('span', { class: 'amount' }, formatCents(l.amount_cents))))),
    detailsView(it));
}

function detailsView(it) {
  const d = it.details || {};
  if (!Array.isArray(d.spots)) return d.notes ? h('p', { class: 'notes small' }, d.notes) : null;
  const facts = [
    d.style ? (d.style === 'mens' ? 'Men\'s' : 'Women\'s') : null, d.size ? 'Size ' + d.size : null, d.color || null,
    d.order_type ? { freemason: 'Freemason', oes: 'OES', other: 'Other' }[d.order_type] : null,
    d.airbrushed ? 'Airbrushed' + (d.design_text ? ': ' + d.design_text : '') : null
  ].filter(Boolean);
  let extraN = 0;
  const spots = d.spots.map((s) => {
    const inc = INCLUDED_SPOTS.find((x) => x.key === s.key);
    const label = inc ? inc.label + (s.key === 'sleeve' ? ' (' + (s.side === 'left' ? 'left' : 'right') + ')' : '') : extraLabel(extraN++) + (s.where ? ' (' + s.where + ')' : '');
    const p = s.patch_no ? store.data.patches.find((x) => x.patch_no === s.patch_no) : null;
    const what = [s.patch_no ? 'No. ' + s.patch_no + (p ? ' ' + p.name : '') : null, s.own_patch ? 'Own patch' : null, s.notes || null].filter(Boolean).join(' · ');
    return what ? h('li', null, h('span', { class: 'muted' }, label + ': '), what) : null;
  }).filter(Boolean);
  return h('div', { class: 'details-view small' },
    facts.length ? h('p', null, facts.join(' · ')) : null,
    d.regalia ? h('p', null, 'Regalia: ' + d.regalia) : null,
    spots.length ? h('ul', { class: 'spot-list' }, spots) : null,
    d.notes ? h('p', { class: 'notes' }, d.notes) : null);
}
