// screens/profit.js: Profit & costs (replaces the Summary tab of Terri's profit spreadsheet).
// Money in comes from the orders; money out from the costs she adds; time from her time entries.
import { h, setChildren, segmented } from '../ui.js';
import { call } from '../api.js';
import { formatCents } from '../money.js';
import { costSheet, categoryShort, formatMinutes, shortDay, todayYmd, profitAmount, formatRate } from '../tracking.js';

const PERIODS = [
  { value: 'month', label: 'This month' },
  { value: 'last', label: 'Last month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' }
];

let lastPeriod = 'month'; // remembered while the app is open

/** Date range (YYYY-MM-DD, both included) for a period, in Phoenix time. */
export function periodRange(period, today = todayYmd()) {
  const [y, m] = today.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (period === 'month') return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
  if (period === 'last') {
    const ly = m === 1 ? y - 1 : y;
    const lm = m === 1 ? 12 : m - 1;
    return { from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${pad(lastDay(ly, lm))}` };
  }
  if (period === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: '', to: '' };
}

export default {
  title: 'Profit & costs',
  tab: 'home',
  back: true,
  render(main, params, view) {
    let period = PERIODS.some((p) => p.value === params.query.period) ? params.query.period : lastPeriod;
    let data = null;
    let error = null;
    const body = h('div');

    const row = (label, value, cls = '') => h('div', { class: 'totals-row ' + cls }, h('span', null, label), value);
    const amt = (cents, minus) => h('span', { class: 'amount' }, (minus && cents ? '−' : '') + formatCents(cents));

    const addGeneral = async () => {
      const r = await costSheet({});
      if (r) load();
    };
    const editGeneral = async (c) => {
      const r = await costSheet({ cost: c });
      if (r) load();
    };

    const draw = () => {
      if (error) { setChildren(body, h('div', { class: 'card empty' }, h('p', null, error))); return; }
      if (!data) { setChildren(body, h('div', { class: 'spinner', 'aria-label': 'Loading' })); return; }
      const t = data.totals;
      const maxCat = Math.max(1, ...data.by_category.map((c) => c.cents));
      const periodWord = PERIODS.find((p) => p.value === period).label.toLowerCase();

      setChildren(body,
        h('section', { class: 'section card profit-hero' },
          h('div', { class: 'label' }, 'Profit ' + (period === 'all' ? 'all time' : periodWord)),
          h('div', { class: 'profit-big' + (t.profit_cents < 0 ? ' loss' : '') }, formatCents(t.profit_cents)),
          h('p', { class: 'small muted', style: { margin: '0 0 12px' } }, 'Money charged minus money spent, before paying yourself.'),
          row('Charged on ' + t.orders + (t.orders === 1 ? ' order' : ' orders'), amt(t.income_cents)),
          row('Spent on orders', amt(t.order_costs_cents, true)),
          row('General spending', amt(t.general_costs_cents, true)),
          row('Profit', profitAmount(t.profit_cents), 'grand'),
          row('Your time: ' + formatMinutes(t.minutes) + ' at ' + formatRate(t.hourly_rate_cents), amt(t.labor_cents, true)),
          row('Profit after paying yourself', profitAmount(t.profit_after_labor_cents), 'strong'),
          t.per_hour_cents !== null ? h('p', { class: 'per-hour' }, 'You earned ', h('strong', null, formatCents(t.per_hour_cents) + ' an hour'), ' for the time you logged.') : null),

        h('section', { class: 'section' },
          h('div', { class: 'snapshot' },
            h('div', { class: 'card' }, h('div', { class: 'num' }, formatCents(t.received_cents)), h('div', { class: 'small muted' }, 'Received so far')),
            h('div', { class: 'card' }, h('div', { class: 'num' }, formatCents(t.owed_cents)), h('div', { class: 'small muted' }, 'Still owed to you')))),

        t.orders_without_costs ? h('div', { class: 'section note-warn' }, h('p', null,
          t.orders_without_costs === 1 ? '1 order has no costs yet, so its profit looks higher than it is.' : t.orders_without_costs + ' orders have no costs yet, so their profit looks higher than it is.')) : null,

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Where the money went'),
          t.spent_cents ? h('ul', { class: 'list cat-list' }, data.by_category.filter((c) => c.cents).map((c) => h('li', null,
            h('div', { class: 'list-row' },
              h('div', { class: 'grow' },
                h('div', null, categoryShort(c.category)),
                h('div', { class: 'cat-bar', 'aria-hidden': 'true' }, h('span', { style: { width: Math.max(2, Math.round(c.cents * 100 / maxCat)) + '%' } }))),
              h('span', { class: 'amount' }, formatCents(c.cents))))))
            : h('p', { class: 'muted' }, 'No spending recorded ' + (period === 'all' ? 'yet.' : periodWord + '.'))),

        data.by_product.length ? h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'By product'),
          h('ul', { class: 'list' }, data.by_product.map((p) => h('li', null,
            h('div', { class: 'list-row' },
              h('div', { class: 'grow' },
                h('div', null, p.product + ' · ' + p.orders + (p.orders === 1 ? ' order' : ' orders')),
                h('div', { class: 'small muted' }, 'Charged ' + formatCents(p.income_cents) + ' · spent ' + formatCents(p.spent_cents) + (p.minutes ? ' · ' + formatMinutes(p.minutes) : ''))),
              profitAmount(p.profit_cents)))))) : null,

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Orders'),
          data.orders.length ? h('ul', { class: 'list' }, data.orders.map((o) => h('li', null,
            h('a', { class: 'list-row', href: '#/orders/' + encodeURIComponent(o.number) },
              h('div', { class: 'grow' },
                h('div', { class: 'title-line' }, h('strong', null, o.number), o.customer_name,
                  !o.cost_count ? h('span', { class: 'badge badge-draft' }, 'No costs yet') : null,
                  o.stage === 'cancelled' ? h('span', { class: 'badge badge-closed' }, 'Cancelled') : null),
                h('div', { class: 'small muted' }, shortDay(o.created_at.slice(0, 10)) + ' · charged ' + formatCents(o.income_cents) + ' · spent ' + formatCents(o.spent_cents) + (o.minutes ? ' · ' + formatMinutes(o.minutes) : ''))),
              profitAmount(o.profit_cents)))))
            : h('p', { class: 'muted' }, 'No sent orders ' + (period === 'all' ? 'yet.' : periodWord + '.')),
          h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Orders count by the day they were made. Drafts, quotes and void orders are left out. Open an order to add its costs and time.')),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'General spending'),
          data.general_costs.length ? h('ul', { class: 'list' }, data.general_costs.map((c) => h('li', null,
            h('button', { type: 'button', class: 'list-row row-button', onclick: () => editGeneral(c), 'aria-label': 'Edit cost: ' + categoryShort(c.category) + ' ' + formatCents(c.amount_cents) },
              h('div', { class: 'grow' },
                h('div', null, categoryShort(c.category) + (c.description ? ' · ' + c.description : '')),
                h('div', { class: 'small muted' }, [shortDay(c.spent_on), c.qty > 1 ? c.qty + ' × ' + formatCents(c.each_cents) : null, c.supplier || null].filter(Boolean).join(' · '))),
              h('span', { class: 'amount' }, formatCents(c.amount_cents))))))
            : h('p', { class: 'muted small' }, 'Spending that isn\'t for one order: patch stock, thread, tools.'),
          h('button', { type: 'button', class: 'btn btn-secondary btn-block', style: { marginTop: '10px' }, onclick: addGeneral }, '+ Add general cost')),

        h('p', { class: 'section small muted' }, 'Change your hourly rate and work tasks in Settings → Profit tracking. Typical costs for each package are on the package screen in Catalog.'));
    };

    const load = async () => {
      const mine = period;
      const range = periodRange(period);
      try {
        const d = await call('profit.get', range);
        if (!view.isCurrent() || mine !== period) return;
        data = d;
        error = null;
      } catch (err) {
        if (!view.isCurrent()) return;
        error = err.message || 'Something went wrong.';
      }
      draw();
    };

    const picker = segmented(PERIODS, period, (v) => {
      period = v;
      lastPeriod = v;
      data = null;
      history.replaceState(null, '', '#/profit?period=' + v);
      draw();
      load();
    }, 'Time period');

    setChildren(main, h('div', { class: 'period-picker' }, picker), body);
    draw();
    load();
    return load;
  }
};

