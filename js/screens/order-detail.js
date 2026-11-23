// screens/order-detail.js: one quote or invoice. For now: summary, items, details and Edit.
// Sending, payments, progress checklist and activity arrive in milestone 6 (SPEC 6.5).
import { h, formatDate, setChildren } from '../ui.js';
import { call } from '../api.js';
import { store, upsertCustomer } from '../store.js';
import { formatCents } from '../money.js';
import { INCLUDED_SPOTS, extraLabel } from '../rules.js';
import { statusBadges } from './orders.js';

export default {
  title: (p) => p.number,
  tab: 'orders',
  back: true,
  async render(main, params, view) {
    setChildren(main, h('div', { class: 'spinner', 'aria-label': 'Loading' }));
    const load = async () => {
      const res = await call('docs.get', { number: params.number });
      if (!view.isCurrent()) return;
      if (res.customer) upsertCustomer(res.customer);
      draw(res);
    };
    const draw = (res) => {
      const d = res.doc;
      const c = res.customer;
      const isQuote = d.type === 'quote';
      view.setTitle((isQuote ? 'Quote ' : 'Invoice ') + d.number);
      const editable = d.status !== 'void' && d.status !== 'converted';
      setChildren(main,
        h('section', { class: 'card' },
          h('div', { class: 'badges' }, statusBadges(d)),
          h('h2', { style: { margin: '10px 0 4px' } }, c ? h('a', { href: '#/customers/' + encodeURIComponent(c.customer_id), style: { color: 'inherit' } }, c.name) : 'No customer'),
          h('div', { class: 'small muted' }, 'Created ' + formatDate(d.created_at)),
          h('div', { class: 'totals-row grand', style: { marginTop: '12px' } }, h('span', null, 'Total'), h('span', { class: 'amount' }, formatCents(d.total_cents))),
          d.type === 'invoice' && d.amount_due_cents !== d.total_cents
            ? h('div', { class: 'totals-row' }, h('span', null, 'Due now'), h('span', { class: 'amount' }, formatCents(d.amount_due_cents))) : null),

        editable ? h('div', { class: 'section' }, h('a', { class: 'btn btn-block', href: '#/orders/' + encodeURIComponent(d.number) + '/edit' }, 'Edit')) : null,

        h('p', { class: 'card small muted section' }, 'Sending, payments and progress tracking come in the next update.'),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Items'),
          res.items.map((it) => itemView(it))),

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
        d.internal_notes ? h('section', { class: 'section' }, h('h2', { class: 'label' }, 'Internal notes'), h('p', { class: 'card notes' }, d.internal_notes)) : null);
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
