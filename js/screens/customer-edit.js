// screens/customer-edit.js: add or edit a customer. When adding, checks for someone with the
// same phone or email first and offers "Use existing customer?" (SPEC 5.9).
import { h, field, textInput, textArea, sheet, toast, withBusy, confirmDialog, showError, setChildren } from '../ui.js';
import { findCustomer, upsertCustomer } from '../store.js';
import { call, ApiError } from '../api.js';
import { navigate, back } from '../router.js';

export default {
  title: (p) => (p.id ? 'Edit Customer' : 'New Customer'),
  tab: 'customers',
  back: true,
  render(main, params) {
    const c = params.id ? findCustomer(params.id) : null;
    if (params.id && !c) {
      setChildren(main, h('div', { class: 'card empty' }, h('h2', null, 'Customer not found'),
        h('a', { class: 'btn btn-secondary', href: '#/customers' }, 'Back to Customers')));
      return;
    }

    const name = textInput(c ? c.name : '', { maxlength: '100', autocomplete: 'off', autocapitalize: 'words' });
    const phone = textInput(c ? c.phone : '', { type: 'tel', inputmode: 'tel', maxlength: '30', autocomplete: 'off' });
    const email = textInput(c ? c.email : '', { type: 'email', inputmode: 'email', maxlength: '100', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const notes = textArea(c ? c.notes : '', { maxlength: '5000', rows: '5' });
    const save = h('button', { class: 'btn btn-block', type: 'submit' }, 'Save customer');

    const payload = (force) => ({
      customer_id: c ? c.customer_id : undefined,
      name: name.value, phone: phone.value, email: email.value, notes: notes.value, force: force || undefined
    });

    const done = (customer) => {
      upsertCustomer(customer);
      toast('Customer saved');
      if (c) back('/customers/' + encodeURIComponent(customer.customer_id));
      else navigate('/customers/' + encodeURIComponent(customer.customer_id), { replace: true });
    };

    const form = h('form', { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      withBusy(save, 'Saving…', async () => {
        if (!name.value.trim()) throw new ApiError('VALIDATION', 'Please type the customer\'s name.');
        const res = await call('customers.save', payload(false));
        if (res.saved) done(res.customer);
        else askUseExisting(res.duplicates, {
          onUse: (d) => navigate('/customers/' + encodeURIComponent(d.customer_id), { replace: true }),
          onSaveNew: async () => {
            const forced = await call('customers.save', payload(true));
            done(forced.customer);
          }
        });
      });
    } },
    field('Name', name),
    field('Phone', phone),
    field('Email', email, 'A phone or email is needed to send quotes and invoices.'),
    field('Notes', notes, 'Sizes, preferences, anything to remember.'),
    h('div', { class: 'form-actions' }, save));

    setChildren(main, form,
      c ? h('section', { class: 'section' }, archiveButton(c)) : null);
    if (!c) name.focus();
  }
};

/**
 * "Use existing customer?" sheet (SPEC 5.9). `onUse(customer)` runs when one is chosen;
 * `onSaveNew()` saves anyway as a separate customer. Also used by the order editor.
 */
export function askUseExisting(duplicates, { onUse, onSaveNew }) {
  sheet((close) => {
    const newBtn = h('button', { class: 'btn btn-secondary btn-block', type: 'button' }, 'No, save as a new customer');
    newBtn.addEventListener('click', () => withBusy(newBtn, 'Saving…', async () => { await onSaveNew(); close(); }));
    return [
      h('h2', null, 'Use existing customer?'),
      h('p', null, duplicates.length === 1
        ? 'Someone with this phone number or email is already saved:'
        : 'These customers have the same phone number or email:'),
      h('div', { class: 'stack' }, duplicates.map((d) => h('div', { class: 'card' },
        h('div', { style: { fontWeight: '500' } }, d.name, d.archived ? ' (archived)' : ''),
        h('div', { class: 'small muted' }, [d.phone, d.email].filter(Boolean).join(' · ')),
        h('button', { class: 'btn btn-block', type: 'button', style: { marginTop: '10px' }, onclick: () => {
          upsertCustomer(d);
          close();
          onUse(d);
        } }, 'Use ' + d.name)))),
      h('div', { class: 'actions' }, newBtn,
        h('button', { class: 'btn-link', type: 'button', onclick: () => close() }, 'Cancel'))
    ];
  });
}

function archiveButton(c) {
  const btn = h('button', { class: c.archived ? 'btn btn-secondary btn-block' : 'btn btn-danger btn-block', type: 'button' },
    c.archived ? 'Restore customer' : 'Archive customer');
  btn.addEventListener('click', async () => {
    if (!c.archived) {
      const ok = await confirmDialog({
        title: 'Archive ' + c.name + '?',
        message: 'They will be hidden from the customer list. Their orders stay, and you can restore them any time.',
        yes: 'Archive', danger: true
      });
      if (!ok) return;
    }
    try {
      btn.disabled = true;
      const res = await call('customers.save', {
        customer_id: c.customer_id, name: c.name, phone: c.phone, email: c.email, notes: c.notes, archived: !c.archived
      });
      upsertCustomer(res.customer);
      toast(res.customer.archived ? 'Customer archived' : 'Customer restored');
      navigate(res.customer.archived ? '/customers' : '/customers/' + encodeURIComponent(c.customer_id), { replace: true });
    } catch (err) {
      btn.disabled = false;
      showError(err);
    }
  });
  return btn;
}
