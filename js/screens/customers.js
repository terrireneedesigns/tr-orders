// screens/customers.js: Customers tab. Full list, search and editing arrive in milestone 3.
import { h } from '../ui.js';
import { store, loadBootstrap } from '../store.js';

export default {
  title: 'Customers',
  tab: 'customers',
  render(main) {
    const draw = () => {
      const list = store.data.customers.filter((c) => !c.archived);
      main.replaceChildren(list.length
        ? h('ul', { class: 'list' }, list.map((c) => h('li', null,
          h('div', { class: 'list-row' },
            h('div', { class: 'grow' }, h('div', null, c.name), h('div', { class: 'small muted' }, c.phone || c.email))))))
        : h('div', { class: 'card empty' },
          h('h2', null, 'No customers yet'),
          h('p', null, 'Customers you add to orders will be listed here.')));
    };
    draw();
    return async () => { await loadBootstrap(); draw(); };
  }
};
