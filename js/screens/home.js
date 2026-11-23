// screens/home.js: Home tab. New order/quote buttons, needs attention, snapshot.
// Live lists and numbers arrive in milestone 7; this is the layout.
import { h } from '../ui.js';
import { loadBootstrap } from '../store.js';

export default {
  title: 'Home',
  tab: 'home',
  render(main) {
    const draw = () => {
      main.replaceChildren(
        h('section', { class: 'section home-actions' },
          h('a', { class: 'btn btn-big', href: '#/new/order' }, '+ New Order'),
          h('a', { class: 'btn btn-big btn-secondary', href: '#/new/quote' }, '+ New Quote')),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Needs attention'),
          h('div', { class: 'card empty' },
            h('h2', null, 'All caught up'),
            h('p', { class: 'small' }, 'Orders that need you will show here.'))),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Snapshot'),
          h('div', { class: 'snapshot' },
            stat('Unpaid total'), stat('Collected this month'),
            stat('Orders in progress'), stat('Ready for pickup or delivery')),
          h('p', { class: 'small muted', style: { marginTop: '8px' } }, 'Numbers appear once orders are added.'))
      );
    };
    draw();
    return async () => { await loadBootstrap(); draw(); };
  }
};

function stat(label) {
  return h('div', { class: 'card' },
    h('div', { class: 'num', 'aria-hidden': 'true' }, '—'),
    h('div', { class: 'small muted' }, label));
}
