// screens/products.js: Catalog tab. Shows what is in the catalog; editing arrives in milestone 3.
import { h } from '../ui.js';
import { store, loadBootstrap } from '../store.js';

export default {
  title: 'Catalog',
  tab: 'catalog',
  render(main) {
    const draw = () => {
      const d = store.data;
      const products = d.products.filter((p) => p.active);
      main.replaceChildren(
        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Products'),
          h('ul', { class: 'list' }, products.map((p) => {
            const pkgs = d.packages.filter((k) => k.product_id === p.product_id && k.active);
            const note = pkgs.map((k) => k.name + (k.price_note ? ' ' + k.price_note : '')).join(' · ');
            return h('li', null, h('div', { class: 'list-row' },
              h('div', { class: 'grow' }, h('div', null, p.name), h('div', { class: 'small muted' }, note))));
          }))),
        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Patches'),
          h('div', { class: 'card' },
            h('p', null, d.patches.filter((p) => p.active).length + ' patches in the catalog.'),
            h('p', { class: 'small muted' }, 'Adding and editing products and patches comes in the next update.'))));
    };
    draw();
    return async () => { await loadBootstrap(); draw(); };
  }
};
