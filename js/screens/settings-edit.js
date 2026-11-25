// screens/settings-edit.js: edit settings (SPEC 6.10). One screen per section:
// business (info and Zelle), rules (days and upfront percent), messages, terms, passcode.
import { h, field, textInput, textArea, moneyInput, iconButton, toast, withBusy, setChildren } from '../ui.js';
import { call, ApiError } from '../api.js';
import { store } from '../store.js';
import { back } from '../router.js';
import { messageFor } from '../share.js';
import { centsToInput, parseMoney } from '../money.js';

const TITLES = {
  business: 'Business & Zelle', rules: 'Rules & days', messages: 'Messages', terms: 'True Value Statement', passcode: 'Change passcode', profit: 'Profit tracking'
};

export default {
  title: (p) => TITLES[p.section] || 'Settings',
  tab: 'settings',
  back: true,
  render(main, params) {
    const s = store.data.settings;
    const build = { business, rules, messages, terms, passcode, profit }[params.section];
    if (!build) {
      setChildren(main, h('div', { class: 'card empty' }, h('p', null, 'That page doesn\'t exist.'), h('a', { class: 'btn btn-secondary', href: '#/settings' }, 'Back to Settings')));
      return;
    }
    build(main, s);
  }
};

/** Form with a sticky Save button. `collect()` returns the values to save (or throws). */
function settingsForm(main, children, collect, okText = 'Saved') {
  const save = h('button', { type: 'submit', class: 'btn btn-block' }, 'Save');
  const form = h('form', { novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    withBusy(save, 'Saving…', async () => {
      store.data.settings = await call('settings.save', { values: collect() });
      toast(okText);
      back('/settings');
    });
  } }, children, h('div', { class: 'form-actions' }, save));
  setChildren(main, form);
}

function text(value, props = {}) {
  return textInput(value == null ? '' : String(value), Object.assign({ autocomplete: 'off' }, props));
}

function business(main, s) {
  const f = {
    business_name: text(s.business_name, { maxlength: '100' }),
    phone: text(s.phone, { type: 'tel', inputmode: 'tel', maxlength: '30' }),
    email: text(s.email, { type: 'email', inputmode: 'email', maxlength: '100', autocapitalize: 'off' }),
    website: text(s.website, { maxlength: '100', autocapitalize: 'off' }),
    zelle_contact: text(s.zelle_contact, { maxlength: '60' }),
    zelle_display_name: text(s.zelle_display_name, { maxlength: '60', autocapitalize: 'characters' }),
    notify_email: text(s.notify_email, { type: 'email', inputmode: 'email', maxlength: '100', autocapitalize: 'off' })
  };
  settingsForm(main, [
    h('h2', { class: 'label' }, 'Business'),
    field('Business name', f.business_name),
    field('Phone', f.phone, 'Shown on customer pages and the "link no longer active" message.'),
    field('Email', f.email),
    field('Website', f.website),
    h('h2', { class: 'label section' }, 'Zelle'),
    field('Zelle phone number or email', f.zelle_contact, 'Customers send Zelle payments here. Only this is shown in the Zelle panel.'),
    field('Name Zelle shows', f.zelle_display_name, 'Customers see "Zelle will show the name …" so they know it\'s you.'),
    h('p', { class: 'small muted' }, 'The Zelle QR code is a picture file (assets/zelle-qr.png). If the Zelle number changes, ask Autumn to replace it too.'),
    h('h2', { class: 'label section' }, 'Emails'),
    field('Send notifications to', f.notify_email, 'Approved and declined quotes, and the daily summary.')
  ], () => Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()])));
}

function rules(main, s) {
  const num = (v) => text(v, { inputmode: 'numeric', maxlength: '3', style: { maxWidth: '140px' } });
  const f = {
    unpaid_flag_days: num(s.unpaid_flag_days),
    ready_flag_days: num(s.ready_flag_days),
    quote_expiry_days: num(s.quote_expiry_days),
    upfront_percent_default: num(s.upfront_percent_default)
  };
  settingsForm(main, [
    field('Unpaid invoice: flag after (days)', f.unpaid_flag_days, 'An invoice not paid this many days after it was sent shows as "Overdue".'),
    field('Ready but not picked up: flag after (days)', f.ready_flag_days, 'Shows as "Ready 3+ days" on Home.'),
    field('Quotes can be approved for (days)', f.quote_expiry_days, 'Counted from when the quote is sent.'),
    field('Upfront percent for new orders', f.upfront_percent_default, 'Usually 100: paid in full at the time of order. Each order can change it under "More options".')
  ], () => {
    const out = {};
    for (const [k, el] of Object.entries(f)) {
      const n = parseInt(el.value, 10);
      if (!Number.isInteger(n)) throw new ApiError('VALIDATION', 'Please type whole numbers only.');
      out[k] = n;
    }
    return out;
  });
}

const SAMPLE_DOC = { number: 'TR-1012', total_cents: 34100, amount_due_cents: 34100, public_id: 'example', fulfillment: 'pickup' };
const SAMPLE_CUSTOMER = { name: 'Denise Carter' };

function messages(main, s) {
  const kinds = [
    ['quote', 'Quote', 'msg_quote'], ['invoice', 'Invoice', 'msg_invoice'],
    ['receipt', 'Receipt (after a payment)', 'msg_receipt'], ['ready', 'Order ready', 'msg_ready']
  ];
  const boxes = {};
  const blocks = kinds.map(([kind, label, key]) => {
    const box = textArea(s[key] || '', { rows: '4', maxlength: '1000' });
    const preview = h('p', { class: 'card small notes', 'aria-live': 'polite' });
    const doc = kind === 'quote' ? { ...SAMPLE_DOC, number: 'Q-1004' } : SAMPLE_DOC;
    const update = () => { preview.textContent = 'Example: ' + messageFor(kind, doc, SAMPLE_CUSTOMER, { ['msg_' + kind]: box.value }); };
    box.addEventListener('input', update);
    update();
    boxes[key] = box;
    return h('div', { class: 'section' }, field(label, box), preview);
  });
  settingsForm(main, [
    h('p', { class: 'small muted' }, 'These words fill in the message when you send from the app. You can use: {first_name}, {name}, {number}, {total}, {amount_due}, {link}, {fulfillment_text}. Keep {link} in quote, invoice and receipt messages so the customer can open their page.'),
    blocks
  ], () => {
    const out = {};
    for (const [key, box] of Object.entries(boxes)) {
      if (!box.value.trim()) throw new ApiError('VALIDATION', 'Messages can\'t be empty.');
      out[key] = box.value.trim();
    }
    return out;
  });
}

function terms(main, s) {
  const title = text(s.terms_title, { maxlength: '100' });
  const items = (s.terms || []).map((t) => ({ title: t.title, text: t.text }));
  const list = h('div', { class: 'line-editor' });
  const draw = () => setChildren(list, items.map((t, i) => {
    const tt = text(t.title, { maxlength: '100', 'aria-label': 'Item ' + (i + 1) + ' title', placeholder: 'Title, e.g. Payment' });
    tt.addEventListener('input', () => { t.title = tt.value; });
    const tx = textArea(t.text, { rows: '3', maxlength: '2000', 'aria-label': 'Item ' + (i + 1) + ' text' });
    tx.addEventListener('input', () => { t.text = tx.value; });
    const up = iconButton('Move item ' + (i + 1) + ' up', '↑', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); });
    const down = iconButton('Move item ' + (i + 1) + ' down', '↓', () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); });
    const del = iconButton('Remove item ' + (i + 1), '✕', () => { items.splice(i, 1); draw(); }, 'danger');
    up.disabled = i === 0;
    down.disabled = i === items.length - 1;
    return h('div', { class: 'line-card' },
      h('div', { class: 'line-bottom' }, h('strong', null, String(i + 1) + '.'), h('span', { class: 'grow' }), up, down, del),
      tt, tx);
  }));
  draw();
  settingsForm(main, [
    field('Heading', title),
    h('p', { class: 'small muted' }, 'Customers see these on every quote and invoice, and agree to them when they approve a quote.'),
    list,
    h('button', { type: 'button', class: 'btn btn-secondary btn-block', style: { marginTop: '12px' }, onclick: () => { items.push({ title: '', text: '' }); draw(); } }, '+ Add item')
  ], () => {
    if (!items.length) throw new ApiError('VALIDATION', 'Keep at least one item.');
    items.forEach((t, i) => { if (!t.title.trim() || !t.text.trim()) throw new ApiError('VALIDATION', 'Item ' + (i + 1) + ' needs a title and text.'); });
    return { terms_title: title.value.trim(), terms: items.map((t) => ({ title: t.title.trim(), text: t.text.trim() })) };
  });
}

function profit(main, s) {
  const rate = moneyInput(centsToInput(Number(s.hourly_rate_cents) || 0));
  const tasks = textArea(s.work_tasks || '', { rows: '10', maxlength: '2000' });
  settingsForm(main, [
    field('Your hourly rate ($ per hour)', rate, 'What you want to pay yourself. Profit is shown before and after this. Starts at $20 as a placeholder.'),
    field('Work tasks', tasks, 'One per line. You pick from these when you add time to an order.'),
    h('p', { class: 'small muted' }, 'See the numbers on Home → Profit & costs. ', h('a', { href: '#/profit' }, 'Open Profit & costs'))
  ], () => {
    const cents = parseMoney(rate.value);
    if (cents === null || cents < 0) throw new ApiError('VALIDATION', 'Please type an hourly rate, like 20 or 25.50.');
    if (!tasks.value.trim()) throw new ApiError('VALIDATION', 'Keep at least one work task.');
    return { hourly_rate_cents: cents, work_tasks: tasks.value };
  });
}

function passcode(main) {
  const pw = (id) => h('input', { class: 'input', type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: id === 'cur' ? 'current-password' : 'new-password', maxlength: '20' });
  const cur = pw('cur');
  const next = pw('new');
  const again = pw('again');
  const save = h('button', { type: 'submit', class: 'btn btn-block' }, 'Change passcode');
  setChildren(main, h('form', { novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    withBusy(save, 'Saving…', async () => {
      if (!/^\d{6,20}$/.test(next.value)) throw new ApiError('VALIDATION', 'The new passcode must be 6 to 20 numbers.');
      if (next.value !== again.value) throw new ApiError('VALIDATION', 'The new passcodes don\'t match.');
      await call('auth.changePasscode', { current: cur.value, next: next.value });
      toast('Passcode changed');
      back('/settings');
    });
  } },
  h('p', { class: 'muted' }, 'Terri and Autumn share one passcode. Phones that are already signed in stay signed in.'),
  field('Current passcode', cur),
  field('New passcode (6 or more numbers)', next),
  field('New passcode again', again),
  h('div', { class: 'form-actions' }, save)));
}
