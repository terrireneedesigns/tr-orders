// screens/home.js: Home tab (SPEC 6.2). New Order / New Quote, Needs attention, Snapshot.
import { h, setChildren, formatDate } from '../ui.js';
import { call } from '../api.js';
import { formatCents } from '../money.js';

const SHOW = 5; // rows per group before "and N more"

/** Groups shown under Needs attention, most urgent first. */
const GROUPS = [
  { key: 'overdue', label: 'Unpaid, overdue', filter: 'unpaid',
    sub: (r) => formatCents(r.amount_due_cents) + ' due · sent ' + day(r.sent_at) },
  { key: 'ready_late', label: 'Ready 3+ days', filter: 'ready',
    sub: (r) => 'Ready since ' + day(r.ready_at) + (r.balance_overdue ? ' · balance overdue' : '') },
  { key: 'not_sent', label: 'Not sent', filter: 'all', sub: (r) => (r.type === 'quote' ? 'Quote' : 'Invoice') + ' made ' + day(r.created_at) },
  { key: 'quotes_expiring', label: 'Quotes expiring soon', filter: 'quotes', sub: (r) => 'Expires ' + day(r.expires_at) },
  { key: 'quotes_waiting', label: 'Quotes waiting', filter: 'quotes', sub: (r) => 'Sent ' + day(r.sent_at) }
];

function day(iso) {
  return iso ? formatDate(iso).replace(/, \d{4}$/, '') : '';
}

export default {
  title: 'Home',
  tab: 'home',
  render(main, params, view) {
    let data = null;

    const needsSection = () => {
      if (!data) return h('div', { class: 'spinner', 'aria-label': 'Loading' });
      const groups = GROUPS.filter((g) => data.needs[g.key].length);
      if (!groups.length) {
        return h('div', { class: 'card empty' }, h('h2', null, 'All caught up'), h('p', { class: 'small' }, 'Nothing needs you right now.'));
      }
      return groups.map((g) => {
        const rows = data.needs[g.key];
        return h('div', { class: 'needs-group' },
          h('h3', { class: 'needs-title' }, g.label, h('span', { class: 'count' }, String(rows.length))),
          h('ul', { class: 'list' },
            rows.slice(0, SHOW).map((r) => h('li', null,
              h('a', { class: 'list-row', href: '#/orders/' + encodeURIComponent(r.number) },
                h('div', { class: 'grow' },
                  h('div', { class: 'title-line' }, h('strong', null, r.number), r.customer_name),
                  h('div', { class: 'small muted' }, g.sub(r))),
                h('span', { class: 'amount' }, formatCents(r.total_cents))))),
            rows.length > SHOW ? h('li', null, h('a', { class: 'list-row small', href: '#/orders?filter=' + g.filter }, 'and ' + (rows.length - SHOW) + ' more…')) : null));
      });
    };

    const stat = (value, label, href) => h('a', { class: 'card stat-card', href },
      h('div', { class: 'num' }, value), h('div', { class: 'small muted' }, label));

    const snapshotSection = () => {
      const s = data && data.snapshot;
      const monthName = data ? new Date(data.month + '-15T12:00:00-07:00').toLocaleDateString('en-US', { month: 'long', timeZone: 'America/Phoenix' }) : '';
      return h('div', { class: 'snapshot' },
        stat(s ? formatCents(s.unpaid_total_cents) : '—', 'Unpaid total', '#/orders?filter=unpaid'),
        stat(s ? formatCents(s.collected_month_cents) : '—', 'Collected' + (monthName ? ' in ' + monthName : ' this month'), '#/orders?filter=all'),
        stat(s ? String(s.in_progress) : '—', 'Orders in progress', '#/orders?filter=in_progress'),
        stat(s ? String(s.ready) : '—', 'Ready for pickup or delivery', '#/orders?filter=ready'));
    };

    const draw = () => setChildren(main,
      h('section', { class: 'section home-actions' },
        h('a', { class: 'btn btn-big', href: '#/new/order' }, '+ New Order'),
        h('a', { class: 'btn btn-big btn-secondary', href: '#/new/quote' }, '+ New Quote')),
      h('section', { class: 'section' }, h('h2', { class: 'label' }, 'Needs attention'), needsSection()),
      h('section', { class: 'section' }, h('h2', { class: 'label' }, 'Snapshot'), snapshotSection(),
        h('a', { class: 'btn btn-secondary btn-block', href: '#/profit', style: { marginTop: '12px' } }, 'Profit & costs')));

    const load = async () => {
      const d = await call('dashboard.get');
      if (!view.isCurrent()) return;
      data = d;
      draw();
    };

    draw();
    load().catch((err) => {
      if (!view.isCurrent()) return;
      setChildren(main.querySelector('.section:nth-child(2)'), h('h2', { class: 'label' }, 'Needs attention'),
        h('div', { class: 'card empty' }, h('p', null, err.message)));
    });
    return load;
  }
};
