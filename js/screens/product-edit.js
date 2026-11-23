// screens/product-edit.js: add or edit a product, its packages and its add-ons.
import { h, field, textInput, textArea, selectInput, toggleRow, moneyInput, sheet, toast, withBusy, setChildren } from '../ui.js';
import { store, loadBootstrap, setCatalog } from '../store.js';
import { call, ApiError } from '../api.js';
import { navigate } from '../router.js';
import { formatCents, centsToInput, parseMoney } from '../money.js';
import { packageTotal, saveOrder, moved, catalogNote, reorderButtons } from './products.js';

const FORMS = [
  { value: 'jacket', label: 'Jacket (patch spots, size)' },
  { value: 'simple', label: 'Simple (notes, photos)' }
];

const RULES = [
  { value: '', label: 'No special rule' },
  { value: 'left_sleeve', label: 'Left sleeve surcharge (added when the sleeve patch is on the left)' },
  { value: 'extra_patch', label: 'Extra patch (counts toward the 3 extra patches)' }
];

export default {
  title: (p) => (p.id ? 'Product' : 'New Product'),
  tab: 'catalog',
  back: true,
  render(main, params, view) {
    const isNew = !params.id;

    const draw = () => {
      const product = isNew ? null : store.data.products.find((p) => p.product_id === params.id);
      if (!isNew && !product) {
        setChildren(main, h('div', { class: 'card empty' }, h('h2', null, 'Product not found'),
          h('a', { class: 'btn btn-secondary', href: '#/catalog' }, 'Back to Catalog')));
        return;
      }
      if (product) view.setTitle(product.name);

      const name = textInput(product ? product.name : '', { maxlength: '100', autocomplete: 'off' });
      const form = selectInput(FORMS, product ? product.detail_form : 'simple');
      const description = textArea(product ? product.description : '', { maxlength: '5000', rows: '3' });
      const active = toggleRow('Show in new orders', product ? product.active : true, 'Turn off to hide it without losing it.');

      const save = h('button', { class: 'btn btn-block', type: 'submit' }, isNew ? 'Save product' : 'Save details');
      const detailsForm = h('form', { novalidate: true, onsubmit: (e) => {
        e.preventDefault();
        withBusy(save, 'Saving…', async () => {
          if (!name.value.trim()) throw new ApiError('VALIDATION', 'Please type a product name.');
          const res = await call('catalog.saveProduct', {
            product_id: product ? product.product_id : undefined,
            name: name.value, detail_form: form.value, description: description.value,
            active: isNew ? true : active.input.checked
          });
          setCatalog(res.catalog);
          toast(isNew ? 'Product added' : 'Saved');
          if (isNew) navigate('/catalog/products/' + encodeURIComponent(res.id), { replace: true });
          else draw();
        });
      } },
      field('Product name', name),
      field('Details form', form, 'Which questions the order editor asks for this product.'),
      field('Description (optional)', description),
      isNew ? null : active,
      isNew ? h('div', { class: 'form-actions' }, save) : save);

      if (isNew) {
        setChildren(main, catalogNote(), detailsForm,
          h('p', { class: 'small muted' }, 'A package called "Custom" is created for you. You can add its price lines next.'));
        return;
      }

      setChildren(main, 
        catalogNote(),
        h('section', { class: 'card' }, detailsForm),
        packagesSection(product, draw),
        addOnsSection(product, draw));
    };

    draw();
    return async () => { await loadBootstrap(); draw(); };
  }
};

function packagesSection(product, redraw) {
  const pkgs = store.data.packages.filter((k) => k.product_id === product.product_id);
  const ids = pkgs.map((k) => k.package_id);
  return h('section', { class: 'section' },
    h('h2', { class: 'label' }, 'Packages'),
    h('ul', { class: 'list' }, pkgs.map((k, i) => h('li', { class: k.active ? '' : 'muted-row' },
      h('div', { class: 'list-row' },
        h('a', { class: 'grow', href: '#/catalog/packages/' + encodeURIComponent(k.package_id), style: { color: 'inherit', textDecoration: 'none' } },
          h('div', { class: 'title-line' }, k.name, k.active ? null : h('span', { class: 'badge badge-draft' }, 'Hidden')),
          h('div', { class: 'small muted' }, lineCount(k.package_id))),
        h('span', { class: 'amount' }, formatCents(packageTotal(k.package_id))),
        reorderButtons(k.name, i, ids.length, (dir) => saveOrder('packages', moved(ids, i, dir), redraw)))))),
    h('a', { class: 'btn btn-secondary btn-block', style: { marginTop: '12px' },
      href: '#/catalog/packages/new?product=' + encodeURIComponent(product.product_id) }, '+ Add package'));
}

function lineCount(packageId) {
  const n = store.data.templateLines.filter((l) => l.package_id === packageId).length;
  return n === 0 ? 'No price lines yet' : n === 1 ? '1 price line' : n + ' price lines';
}

function addOnsSection(product, redraw) {
  const addOns = store.data.addOns.filter((a) => a.product_id === product.product_id);
  const ids = addOns.map((a) => a.addon_id);
  return h('section', { class: 'section' },
    h('h2', { class: 'label' }, 'Add-ons'),
    addOns.length
      ? h('ul', { class: 'list' }, addOns.map((a, i) => h('li', { class: a.active ? '' : 'muted-row' },
        h('div', { class: 'list-row' },
          h('button', { type: 'button', class: 'grow list-row button-row', style: { padding: 0, minHeight: 0 }, onclick: () => editAddOn(product, a, redraw) },
            h('div', null,
              h('div', { class: 'title-line' }, a.label, a.active ? null : h('span', { class: 'badge badge-draft' }, 'Hidden')),
              h('div', { class: 'small muted' }, (a.price_editable ? 'from ' : '') + formatCents(a.amount_cents) + ruleNote(a.rule)))),
          reorderButtons(a.label, i, ids.length, (dir) => saveOrder('addOns', moved(ids, i, dir), redraw))))))
      : h('p', { class: 'muted' }, 'No add-ons yet.'),
    h('button', { class: 'btn btn-secondary btn-block', style: { marginTop: '12px' }, onclick: () => editAddOn(product, null, redraw) }, '+ Add add-on'));
}

function ruleNote(rule) {
  return rule === 'left_sleeve' ? ' · added automatically for a left sleeve' : rule === 'extra_patch' ? ' · extra patch' : '';
}

function editAddOn(product, addOn, redraw) {
  sheet((close) => {
    const label = textInput(addOn ? addOn.label : '', { maxlength: '200', autocomplete: 'off' });
    const amount = moneyInput(addOn ? centsToInput(addOn.amount_cents) : '');
    const editable = toggleRow('Price can change per order', addOn ? addOn.price_editable : false, 'Shown as "from $20".');
    const rule = selectInput(RULES, addOn ? addOn.rule : '');
    const active = toggleRow('Show in new orders', addOn ? addOn.active : true);
    const save = h('button', { class: 'btn btn-block', type: 'submit' }, 'Save add-on');
    return h('form', { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      withBusy(save, 'Saving…', async () => {
        const cents = parseMoney(amount.value);
        if (!label.value.trim()) throw new ApiError('VALIDATION', 'Please describe the add-on.');
        if (cents === null) throw new ApiError('VALIDATION', 'Please type the price, like 35 or 35.00.');
        const res = await call('catalog.saveAddOn', {
          addon_id: addOn ? addOn.addon_id : undefined, product_id: product.product_id,
          label: label.value, amount_cents: cents, price_editable: editable.input.checked,
          rule: rule.value, active: active.input.checked
        });
        setCatalog(res.catalog);
        toast('Add-on saved');
        close();
        redraw();
      });
    } },
    h('h2', null, addOn ? 'Edit add-on' : 'New add-on'),
    field('Description', label, 'What the customer sees, e.g. "Rush turnaround".'),
    field('Price ($)', amount),
    editable, field('Special rule', rule), active,
    h('div', { class: 'actions' }, save,
      h('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => close() }, 'Cancel')));
  });
}
