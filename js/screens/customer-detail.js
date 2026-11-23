// screens/customer-detail.js: one customer. Call/text/email, notes, stats, order history.
import { h, formatDate, showError, setChildren } from '../ui.js';
import { findCustomer, upsertCustomer } from '../store.js';
import { call } from '../api.js';
import { formatCents } from '../money.js';
import { customerBadges } from './customers.js';

const STATUS = {
  quote: { draft: 'Draft', sent: 'Sent', approved: 'Approved', declined: 'Declined', expired: 'Expired', converted: 'Converted' },
  invoice: { awaiting_payment: 'Awaiting payment', in_progress: 'In progress', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' }
};

function orderStatus(o) {
  if (o.type === 'quote') return STATUS.quote[o.status] || o.status;
  if (o.status === 'void') return 'Void';
  if (o.status === 'draft') return 'Draft';
  return STATUS.invoice[o.stage] || o.stage;
}

export default {
  title: 'Customer',
  tab: 'customers',
  back: true,
  async render(main, params, view) {
    const id = params.id;
    let orders = null;

    const draw = () => {
      const c = findCustomer(id);
      if (!c) {
        setChildren(main, h('div', { class: 'card empty' }, h('h2', null, 'Customer not found'),
          h('a', { class: 'btn btn-secondary', href: '#/customers' }, 'Back to Customers')));
        return;
      }
      view.setTitle(c.name);
      const s = c.stats;
      const digits = (c.phone || '').replace(/[^\d+]/g, '');
      setChildren(main, 
        c.archived ? h('p', { class: 'card small' }, 'This customer is archived, so they are hidden from the list. Edit to restore.') : null,

        h('section', { class: 'section' },
          h('div', { class: 'badges', style: { marginBottom: '12px' } }, customerBadges(c)),
          (c.phone || c.email)
            ? h('div', { class: 'contact-actions' },
              c.phone ? h('a', { class: 'btn btn-secondary', href: 'tel:' + digits }, 'Call') : null,
              c.phone ? h('a', { class: 'btn btn-secondary', href: 'sms:' + digits }, 'Text') : null,
              c.email ? h('a', { class: 'btn btn-secondary', href: 'mailto:' + c.email }, 'Email') : null)
            : h('p', { class: 'muted' }, 'No phone or email yet.'),
          h('p', { class: 'small muted', style: { marginTop: '10px' } }, [c.phone, c.email].filter(Boolean).join(' · '))),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Notes'),
          h('div', { class: 'card notes' }, c.notes || h('span', { class: 'muted' }, 'No notes yet. Sizes and preferences can go here.'))),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'At a glance'),
          s ? h('div', { class: 'stats' },
            stat(String(s.orders), s.orders === 1 ? 'Order' : 'Orders'),
            stat(formatCents(s.total_spent_cents).replace(/\.00$/, ''), 'Total spent'),
            stat(s.last_order_at ? formatDate(s.last_order_at).replace(/, \d{4}$/, '') : '—', 'Last order'))
            : h('div', { class: 'spinner', 'aria-label': 'Loading' })),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Order history'),
          orders === null ? h('div', { class: 'spinner', 'aria-label': 'Loading' })
            : orders.length ? h('ul', { class: 'list' }, orders.map((o) => h('li', null,
              h('a', { class: 'list-row', href: '#/orders/' + encodeURIComponent(o.number) },
                h('div', { class: 'grow' },
                  h('div', null, o.number || (o.type === 'quote' ? 'Quote' : 'Order')),
                  h('div', { class: 'small muted' }, orderStatus(o) + ' · ' + formatDate(o.created_at))),
                h('span', { class: 'amount' }, formatCents(o.total_cents))))))
              : h('p', { class: 'muted' }, 'No orders yet.')),

        h('section', { class: 'section stack' },
          h('a', { class: 'btn btn-block', href: '#/new/order?customer=' + encodeURIComponent(id) }, '+ New order for ' + firstName(c.name)),
          h('a', { class: 'btn btn-secondary btn-block', href: '#/customers/' + encodeURIComponent(id) + '/edit' }, 'Edit customer')));
    };

    const load = async () => {
      const res = await call('customers.get', { customer_id: id });
      upsertCustomer(res.customer);
      orders = res.orders;
      if (view.isCurrent()) draw();
    };

    draw();
    load().catch((err) => { if (view.isCurrent()) { orders = []; draw(); showError(err); } });
    return load;
  }
};

function stat(value, label) {
  return h('div', { class: 'card' }, h('div', { class: 'num' }, value), h('div', { class: 'small muted' }, label));
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'this customer';
}
