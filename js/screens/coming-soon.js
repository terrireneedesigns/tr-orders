// screens/coming-soon.js: stand-in for screens built in later milestones (New Order, New Quote).
import { h, setChildren } from '../ui.js';

export default {
  title: (p) => (p.type === 'quote' ? 'New Quote' : 'New Order'),
  tab: null,
  back: true,
  render(main, p) {
    setChildren(main, h('div', { class: 'card empty' },
      h('h2', null, 'Coming soon'),
      h('p', null, (p.type === 'quote' ? 'Creating quotes' : 'Creating orders') + ' arrives with the order editor.'),
      h('a', { class: 'btn btn-secondary', href: '#/home' }, 'Back to Home')));
  }
};
