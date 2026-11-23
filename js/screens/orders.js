// screens/orders.js: Orders tab (SPEC 6.3). Filters, search, rows with status badge and flag chips.
import { h, searchBox, setChildren } from '../ui.js';
import { call } from '../api.js';
import { formatCents } from '../money.js';
import { statusInfo } from '../rules.js';

const FILTERS = [
  { value: 'all', label: 'All' }, { value: 'quotes', label: 'Quotes' }, { value: 'unpaid', label: 'Unpaid' },
  { value: 'in_progress', label: 'In progress' }, { value: 'ready', label: 'Ready' }, { value: 'completed', label: 'Completed' }
];
const PAGE = 50;

let filter = 'all';
let query = '';

/** Status badge plus small flag chips (Not sent, Viewed, Overdue). */
export function statusBadges(doc) {
  const s = statusInfo(doc);
  const f = doc.flags || {};
  return [
    h('span', { class: 'badge badge-' + s.badge }, s.label),
    f.not_sent ? h('span', { class: 'badge badge-draft' }, 'Not sent') : null,
    f.viewed ? h('span', { class: 'badge badge-viewed' }, 'Viewed') : null,
    f.overdue ? h('span', { class: 'badge badge-overdue' }, 'Overdue') : null,
    f.ready_late ? h('span', { class: 'badge badge-overdue' }, 'Ready 3+ days') : null
  ];
}

export default {
  title: 'Orders',
  tab: 'orders',
  render(main, params, view) {
    if (params.query && FILTERS.some((f) => f.value === params.query.filter)) filter = params.query.filter;
    let rows = [];
    let total = 0;
    let searchTimer = null;
    const listWrap = h('div');

    const drawList = () => {
      if (!rows.length) {
        setChildren(listWrap, h('div', { class: 'card empty' },
          query.trim() ? h('p', null, 'Nothing matches "' + query.trim() + '".')
            : [h('h2', null, filter === 'all' ? 'No orders yet' : 'Nothing here'), h('p', null, 'Quotes and invoices you save show here.')]));
        return;
      }
      setChildren(listWrap,
        h('ul', { class: 'list' }, rows.map((r) => h('li', { class: r.status === 'void' ? 'muted-row' : '' },
          h('a', { class: 'list-row', href: '#/orders/' + encodeURIComponent(r.number) },
            h('div', { class: 'grow' },
              h('div', { class: 'title-line' }, h('strong', null, r.number), r.customer_name),
              h('div', { class: 'badges', style: { marginTop: '4px' } }, statusBadges(r))),
            h('span', { class: 'amount' }, formatCents(r.total_cents)))))),
        rows.length < total ? h('button', { type: 'button', class: 'btn btn-secondary btn-block', style: { marginTop: '12px' },
          onclick: () => load(rows.length) }, 'Show more') : null);
    };

    const load = async (offset = 0) => {
      const res = await call('docs.list', { filter, q: query, offset, limit: PAGE });
      if (!view.isCurrent()) return;
      rows = offset ? rows.concat(res.rows) : res.rows;
      total = res.total;
      drawList();
    };

    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' }, FILTERS.map((f) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(f.value === filter),
      onclick: (e) => {
        filter = f.value;
        chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
        setChildren(listWrap, h('div', { class: 'spinner', 'aria-label': 'Loading' }));
        load().catch(() => {});
      }
    }, f.label)));

    setChildren(main,
      h('div', { class: 'home-actions', style: { marginBottom: '16px' } },
        h('a', { class: 'btn', href: '#/new/order' }, '+ New Order'),
        h('a', { class: 'btn btn-secondary', href: '#/new/quote' }, '+ New Quote')),
      chips,
      h('div', { class: 'toolbar', style: { marginTop: '12px' } },
        searchBox('Name, phone or number', (v) => {
          query = v;
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => load().catch(() => {}), 300);
        }, query)),
      listWrap);
    setChildren(listWrap, h('div', { class: 'spinner', 'aria-label': 'Loading' }));
    load().catch((err) => { setChildren(listWrap, h('div', { class: 'card empty' }, h('p', null, err.message))); });
    return () => load();
  }
};
