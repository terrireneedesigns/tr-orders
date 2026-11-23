// screens/orders.js: Orders tab. The list, filters and search arrive with the order editor.
import { h } from '../ui.js';

export default {
  title: 'Orders',
  tab: 'orders',
  render(main) {
    main.replaceChildren(
      h('div', { class: 'card empty' },
        h('h2', null, 'No orders yet'),
        h('p', null, 'Quotes and invoices will be listed here.')),
      h('div', { class: 'section home-actions' },
        h('a', { class: 'btn', href: '#/new/order' }, '+ New Order'),
        h('a', { class: 'btn btn-secondary', href: '#/new/quote' }, '+ New Quote')));
  }
};
