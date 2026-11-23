// screens/customers.js: Customers tab. Search, badges (Repeat customer, Has unpaid), add.
import { h, searchBox, setChildren } from '../ui.js';
import { store } from '../store.js';
import { call } from '../api.js';

let query = '';
let showArchived = false;

/** Badges for a customer with stats: Repeat customer, Has unpaid. */
export function customerBadges(c) {
  const s = c.stats;
  if (!s) return null;
  const out = [];
  if (s.repeat) out.push(h('span', { class: 'badge badge-repeat' }, 'Repeat customer'));
  if (s.has_unpaid) out.push(h('span', { class: 'badge badge-overdue' }, 'Has unpaid'));
  return out.length ? out : null;
}

function matches(c, q) {
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  return c.name.toLowerCase().includes(q) ||
    (c.email || '').toLowerCase().includes(q) ||
    (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits));
}

async function loadList() {
  store.data.customers = await call('customers.list');
}

export default {
  title: 'Customers',
  tab: 'customers',
  render(main, params, view) {
    const listWrap = h('div');

    const drawList = () => {
      const q = query.trim().toLowerCase();
      const all = store.data.customers;
      const archivedCount = all.filter((c) => c.archived).length;
      const shown = all.filter((c) => (showArchived || !c.archived) && matches(c, q));

      const list = shown.length
        ? h('ul', { class: 'list' }, shown.map((c) => h('li', { class: c.archived ? 'muted-row' : '' },
          h('a', { class: 'list-row', href: '#/customers/' + encodeURIComponent(c.customer_id) },
            h('div', { class: 'grow' },
              h('div', { class: 'title-line' }, c.name, c.archived ? h('span', { class: 'badge badge-draft' }, 'Archived') : null),
              h('div', { class: 'small muted' }, [c.phone, c.email].filter(Boolean).join(' · ') || 'No phone or email'),
              h('div', { class: 'badges', style: { marginTop: '4px' } }, customerBadges(c))),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')))))
        : h('div', { class: 'card empty' },
          q ? h('p', null, 'No customer matches "' + query.trim() + '".')
            : [h('h2', null, 'No customers yet'), h('p', null, 'Add a customer here or while making an order.')]);

      setChildren(listWrap, list,
        archivedCount ? h('p', { class: 'center', style: { marginTop: '16px' } },
          h('button', { type: 'button', class: 'btn-link', onclick: () => { showArchived = !showArchived; drawList(); } },
            showArchived ? 'Hide archived customers' : 'Show archived customers (' + archivedCount + ')')) : null);
    };

    setChildren(main, 
      h('div', { class: 'toolbar' },
        searchBox('Search name, phone or email', (v) => { query = v; drawList(); }, query),
        h('a', { class: 'btn', href: '#/customers/new' }, '+ New')),
      listWrap);
    drawList();

    // Fetch fresh stats (badges) in the background; the list shows right away from memory.
    loadList().then(() => { if (view.isCurrent()) drawList(); }).catch(() => {});

    return async () => { await loadList(); drawList(); };
  }
};
