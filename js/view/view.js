// view/view.js: the customer's quote or invoice page (SPEC 8). One link, no login.
// All text is set with textContent (via h()), never innerHTML.
import { API_URL } from '../config.js';
import { h, setChildren } from '../ui.js';
import { formatCents } from '../money.js';

const page = document.getElementById('page');
const params = new URLSearchParams(location.search);
let publicId = params.get('id') || '';
const preview = params.get('preview') === '1';
const FALLBACK_CONTACT = 'Please contact Terri Renee Evolvé at 623-521-6235.';

/** Terri's sign-in token, if this browser has one, so her own visits don't count as views. */
function adminToken() {
  try { return localStorage.getItem('tr_token') || ''; } catch (e) { return ''; }
}

async function api(action, payload) {
  if (!API_URL) throw new Error('This page is not connected yet. ' + FALLBACK_CONTACT);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: adminToken() || undefined, payload })
    });
  } catch (err) {
    throw new Error('We couldn\'t load this page. Check your internet connection and try again.');
  }
  let json;
  try { json = await res.json(); } catch (err) { throw new Error('Something went wrong. Please try again in a moment.'); }
  if (!json.ok) {
    const e = new Error(json.error && json.error.message ? json.error.message : 'Something went wrong. Please try again.');
    e.code = json.error && json.error.code;
    throw e;
  }
  return json.data;
}

/* ---------- formatting ---------- */

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T12:00:00-07:00' : iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { timeZone: 'America/Phoenix', month: 'long', day: 'numeric', year: 'numeric' });
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/** Status pill for the customer (SPEC 8.1 item 2). */
function pill(doc) {
  if (doc.type === 'quote') {
    return {
      draft: ['Draft', 'draft'], sent: ['Ready for your review', 'sent'], approved: ['Approved', 'paid'],
      converted: ['Approved', 'paid'], declined: ['Declined', 'closed'], expired: ['Expired', 'closed']
    }[doc.status] || ['Quote', 'sent'];
  }
  if (doc.stage === 'cancelled') return ['Cancelled', 'closed'];
  if (doc.stage === 'completed') return ['Completed', 'paid'];
  if (doc.stage === 'ready') return [doc.fulfillment === 'delivery' ? 'Ready for delivery' : 'Ready for pickup', 'ready'];
  if (doc.total_cents > 0 && doc.paid_cents >= doc.total_cents) return ['Paid in full', 'paid'];
  if (doc.stage === 'in_progress') return ['In progress', 'progress'];
  if (doc.status === 'draft') return ['Draft', 'draft'];
  return ['Awaiting payment', 'sent'];
}

/* ---------- copy to clipboard ---------- */

/** Older copy method, for browsers that refuse the Clipboard API. */
function copyWithSelection(text) {
  const t = h('textarea', { readonly: true, style: { position: 'fixed', top: '0', left: '0', opacity: '0' } });
  t.value = text;
  document.body.appendChild(t);
  t.select();
  t.setSelectionRange(0, text.length); // iOS
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
  t.remove();
  return ok;
}

async function copyText(text, button) {
  const old = button.textContent;
  let ok = false;
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); ok = true; } catch (err) { ok = false; }
  }
  if (!ok) ok = copyWithSelection(text);
  button.textContent = ok ? 'Copied!' : 'Copy failed';
  setTimeout(() => { button.textContent = old; }, 2000);
}

/* ---------- sections ---------- */

function itemsSection(items) {
  return h('section', { class: 'view-section' },
    h('h2', { class: 'label' }, items.length === 1 ? 'Your item' : 'Your items'),
    items.map((it) => {
      const unit = it.lines.reduce((t, l) => t + l.amount_cents, 0);
      return h('article', { class: 'v-item' },
        h('div', { class: 'v-item-head' }, h('h3', null, it.title), it.qty > 1 ? h('span', { class: 'muted' }, 'Qty ' + it.qty) : null),
        it.lines.length ? h('ul', { class: 'v-lines' }, it.lines.map((l) =>
          h('li', null, h('span', null, l.label), h('span', { class: 'amt' }, formatCents(l.amount_cents))))) : null,
        h('div', { class: 'v-item-total' },
          h('span', null, it.qty > 1 ? 'Item total (' + formatCents(unit) + ' × ' + it.qty + ')' : 'Item total'),
          h('span', { class: 'v-amount' }, formatCents(unit * it.qty))),
        detailsBlock(it.details));
    }));
}

function detailsBlock(d) {
  if (!d) return null;
  if (!('spots' in d)) return d.notes ? h('div', { class: 'v-details' }, h('p', { class: 'v-notes' }, d.notes)) : null;
  const facts = [d.style, d.size ? 'Size ' + d.size : '', d.color, d.order_type].filter(Boolean);
  const parts = [
    facts.length ? h('p', null, facts.join(' · ')) : null,
    d.airbrushed ? h('p', null, 'Airbrushed' + (d.design_text ? ': ' + d.design_text : '')) : null,
    d.regalia ? h('p', null, 'Regalia or emblem: ' + d.regalia) : null,
    d.spots.length ? h('table', { class: 'v-spots' },
      h('caption', { class: 'visually-hidden' }, 'Patch placement'),
      h('tbody', null, d.spots.map((s) => h('tr', null,
        h('th', { scope: 'row' }, s.label),
        h('td', null, [s.patch_no ? 'No. ' + s.patch_no + (s.patch_name ? ' ' + s.patch_name : '') : '', s.own_patch ? 'Your own patch' : '', s.notes]
          .filter(Boolean).join(' · ')))))) : null,
    d.notes ? h('p', { class: 'v-notes' }, d.notes) : null
  ].filter(Boolean);
  return parts.length ? h('div', { class: 'v-details' }, parts) : null;
}

function totalsSection(doc) {
  return h('section', { class: 'view-section v-totals' },
    h('div', { class: 'v-row' }, h('span', null, 'Subtotal'), h('span', { class: 'v-amount' }, formatCents(doc.subtotal_cents))),
    doc.discount_cents ? h('div', { class: 'v-row' }, h('span', null, 'Discount' + (doc.discount_label ? ' (' + doc.discount_label + ')' : '')),
      h('span', { class: 'v-amount' }, '−' + formatCents(doc.discount_cents))) : null,
    h('div', { class: 'v-row grand' }, h('span', null, 'Total'), h('span', { class: 'v-amount' }, formatCents(doc.total_cents))),
    doc.paid_cents ? h('div', { class: 'v-row' }, h('span', null, 'Paid'), h('span', { class: 'v-amount' }, formatCents(doc.paid_cents))) : null);
}

/** Amount due panel with Zelle and cash (SPEC 8.1 item 5). Only when something is due now. */
function duePanel(doc, biz) {
  if (doc.type !== 'invoice' || doc.amount_due_cents <= 0 || doc.stage === 'cancelled' || doc.status === 'draft') return null;
  const partialUpfront = doc.upfront_percent < 100 && doc.paid_cents < doc.upfront_cents;
  const heading = partialUpfront ? 'Due now' : doc.paid_cents > 0 ? 'Balance due' : 'Total due';
  const amountText = formatCents(doc.amount_due_cents);
  const copyNumber = h('button', { type: 'button', class: 'btn btn-copy' }, 'Copy number');
  copyNumber.addEventListener('click', () => copyText(biz.zelle_contact, copyNumber));
  const copyAmount = h('button', { type: 'button', class: 'btn btn-copy' }, 'Copy amount');
  copyAmount.addEventListener('click', () => copyText((doc.amount_due_cents / 100).toFixed(2), copyAmount));

  return h('section', { class: 'view-section due-panel', 'aria-labelledby': 'due-heading' },
    h('p', { class: 'label', id: 'due-heading' }, heading),
    h('div', { class: 'copy-row' }, h('div', { class: 'due-amount' }, amountText), copyAmount),
    partialUpfront ? h('p', { class: 'muted-on-dark' },
      'Balance due when your order is ready: ' + formatCents(doc.total_cents - doc.upfront_cents)) : null,

    h('h3', null, 'Pay with Zelle'),
    h('div', { class: 'zelle' },
      h('div', { class: 'zelle-qr' }, h('img', { src: 'assets/zelle-qr.png', width: '180', height: '180', alt: 'Zelle QR code for ' + biz.zelle_display_name, loading: 'lazy' })),
      h('div', { class: 'copy-row' }, h('div', null, h('div', { class: 'muted-on-dark' }, 'Send to'), h('div', { class: 'value' }, biz.zelle_contact)), copyNumber),
      h('p', null, 'Zelle will show the name ' + biz.zelle_display_name + '.'),
      h('p', null, 'Put ', h('span', { class: 'memo' }, doc.number), ' in the memo.')),

    h('h3', null, 'Pay with cash'),
    h('p', null, 'Pay in person when you place your order.'),

    h('p', { class: 'policy' }, doc.upfront_percent < 100
      ? 'The amount due now is paid at the time of order, and the balance when your order is ready. Work begins once payment is received.'
      : 'Paid in full at the time of order. Work begins once payment is received.'));
}

function paymentsSection(payments) {
  if (!payments.length) return null;
  return h('section', { class: 'view-section' },
    h('h2', { class: 'label' }, 'Payments received'),
    h('ul', { class: 'v-payments' }, payments.map((p) => h('li', null,
      h('span', null, fmtDate(p.paid_on) + ' · ' + (p.method === 'zelle' ? 'Zelle' : 'Cash')),
      h('span', { class: 'v-amount' }, formatCents(p.amount_cents))))));
}

function fulfillmentSection(doc) {
  return h('section', { class: 'view-section' },
    h('h2', { class: 'label' }, doc.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'),
    h('p', null, doc.fulfillment === 'delivery' ? 'We\'ll be in touch to arrange delivery. No delivery fee.' : 'Pick up from us when your order is ready.'),
    doc.est_ready_date ? h('p', null, 'Estimated ready date: ', h('strong', null, fmtDate(doc.est_ready_date)), ' (estimate)') : null);
}

function termsSection(biz, open) {
  if (!biz.terms || !biz.terms.length) return null;
  return h('section', { class: 'view-section' },
    h('details', { class: 'terms', open: open || undefined },
      h('summary', null, biz.terms_title || 'Terms'),
      h('ol', null, biz.terms.map((t) => h('li', null, h('strong', null, t.title + ': '), t.text)))));
}

function approveSection(data, rerender) {
  const doc = data.doc;
  const agree = h('input', { type: 'checkbox', id: 'agree' });
  const name = h('input', { class: 'input', id: 'fullname', type: 'text', autocomplete: 'name', maxlength: '100', autocapitalize: 'words' });
  const error = h('p', { class: 'error', role: 'alert' });
  const approve = h('button', { type: 'submit', class: 'btn btn-block', disabled: true }, 'Approve quote');
  const update = () => { approve.disabled = !(agree.checked && name.value.trim()); };
  agree.addEventListener('change', update);
  name.addEventListener('input', update);

  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (approve.disabled) return;
    approve.disabled = true;
    approve.textContent = 'Approving…';
    error.textContent = '';
    try {
      const inv = await api('public.approveQuote', { public_id: doc.public_id, name: name.value.trim(), terms_accepted: true });
      publicId = inv.doc.public_id;
      history.replaceState(null, '', '?id=' + encodeURIComponent(publicId) + (preview ? '&preview=1' : ''));
      rerender(inv, h('div', { class: 'banner thanks', role: 'status' },
        h('p', null, h('strong', null, 'Thank you, ' + (firstName(name.value) || 'and welcome') + '! Your quote is approved.')),
        h('p', null, 'Here is your invoice ' + inv.doc.number + '. Payment details are below.')));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      error.textContent = err.message;
      approve.textContent = 'Approve quote';
      update();
    }
  } },
  h('h2', null, 'Approve this quote'),
  h('p', null, 'When you approve, your invoice with payment details appears right here.'),
  h('label', { class: 'check-row', for: 'agree' }, agree, h('span', null, 'I have read and agree to the ' + (data.business.terms_title || 'terms') + '.')),
  h('div', { class: 'field' }, h('label', { for: 'fullname' }, 'Type your full name'), name),
  approve,
  error);

  const declineWrap = h('div');
  const showDecline = () => {
    const note = h('textarea', { class: 'input', rows: '3', maxlength: '1000', id: 'declinenote' });
    const send = h('button', { type: 'button', class: 'btn btn-danger btn-block' }, 'Decline quote');
    const derr = h('p', { class: 'error', role: 'alert' });
    send.addEventListener('click', async () => {
      send.disabled = true;
      send.textContent = 'Sending…';
      try {
        const res = await api('public.declineQuote', { public_id: doc.public_id, note: note.value });
        rerender(res, h('div', { class: 'banner', role: 'status' }, h('p', null, 'Thanks for letting us know. If you change your mind, just get in touch.')));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (err) {
        derr.textContent = err.message;
        send.disabled = false;
        send.textContent = 'Decline quote';
      }
    });
    setChildren(declineWrap, h('div', { class: 'decline-box' },
      h('div', { class: 'field', style: { marginBottom: '0' } }, h('label', { for: 'declinenote' }, 'Anything you\'d like us to know? (optional)'), note),
      send,
      h('button', { type: 'button', class: 'btn-link', onclick: () => setChildren(declineWrap, declineLink()) }, 'Never mind'),
      derr));
    note.focus();
  };
  const declineLink = () => h('p', { class: 'center', style: { margin: '12px 0 0' } },
    h('button', { type: 'button', class: 'btn-link', onclick: showDecline }, 'Decline this quote'));
  setChildren(declineWrap, declineLink());

  return h('section', { class: 'view-section approve-box no-print' }, form, declineWrap);
}

function footer(biz) {
  const tel = (biz.phone || '').replace(/[^\d+]/g, '');
  const site = biz.website ? (/^https?:/i.test(biz.website) ? biz.website : 'https://' + biz.website) : '';
  return h('footer', { class: 'view-footer' },
    h('p', { class: 'biz' }, biz.name),
    biz.phone ? h('p', null, h('a', { href: 'tel:' + tel }, biz.phone)) : null,
    biz.email ? h('p', null, h('a', { href: 'mailto:' + biz.email }, biz.email)) : null,
    site ? h('p', null, h('a', { href: site, rel: 'noopener' }, biz.website)) : null);
}

/* ---------- page ---------- */

function render(data, topBanner) {
  const { doc, business: biz } = data;
  const isQuote = doc.type === 'quote';
  const [pillText, pillClass] = pill(doc);
  document.title = (isQuote ? 'Quote ' : 'Invoice ') + doc.number + ' · ' + (biz.name || 'Terri Renee Evolvé');

  const banners = [
    topBanner || null,
    preview || adminToken() ? h('div', { class: 'banner no-print' }, h('p', null, 'Preview: this is what your customer sees. Your visits are not counted as views.')) : null,
    doc.status === 'draft' ? h('div', { class: 'banner no-print' }, h('p', null, 'Draft: the customer can\'t open this link until it is sent.')) : null,
    isQuote && doc.status === 'expired' ? h('div', { class: 'banner' }, h('p', null, 'This quote has expired. Contact us to renew it.')) : null,
    isQuote && doc.status === 'declined' && !topBanner ? h('div', { class: 'banner' }, h('p', null, 'This quote was declined.')) : null
  ];

  const printBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block no-print', onclick: () => window.print() }, 'Save as PDF');

  setChildren(page,
    banners,
    h('section', null,
      h('h1', { class: 'doc-title' }, (isQuote ? 'Quote ' : 'Invoice ') + doc.number),
      h('p', { class: 'doc-meta' },
        fmtDate(doc.sent_at || doc.created_at),
        data.customer.name ? [' · for ', h('strong', null, data.customer.name)] : null,
        doc.from_quote_number ? ' · From quote ' + doc.from_quote_number : null),
      h('span', { class: 'badge pill badge-' + pillClass }, pillText)),
    doc.customer_note ? h('section', { class: 'view-section' }, h('p', { class: 'v-notes' }, doc.customer_note)) : null,
    itemsSection(data.items),
    totalsSection(doc),
    duePanel(doc, biz),
    paymentsSection(data.payments),
    fulfillmentSection(doc),
    termsSection(biz, isQuote),
    isQuote && doc.status === 'sent' ? approveSection(data, render) : null,
    h('section', { class: 'view-section view-actions' }, printBtn),
    footer(biz));
}

function renderInactive(message) {
  document.title = 'Terri Renee Evolvé';
  setChildren(page, h('section', { class: 'inactive' },
    h('h1', null, 'Link not available'),
    h('p', null, message || 'This link is no longer active. ' + FALLBACK_CONTACT),
    h('p', null, h('a', { class: 'btn btn-secondary', href: 'tel:6235216235' }, 'Call 623-521-6235'))));
}

async function start() {
  if (!publicId) { renderInactive(); return; }
  try {
    const data = await api('public.getDocument', { public_id: publicId, preview: preview || undefined });
    if (data.doc.public_id !== publicId) {
      // An old quote link that became an invoice: show the invoice's own link in the address bar.
      publicId = data.doc.public_id;
      history.replaceState(null, '', '?id=' + encodeURIComponent(publicId) + (preview ? '&preview=1' : ''));
    }
    render(data);
  } catch (err) {
    if (err.code === 'NOT_FOUND') renderInactive(err.message);
    else {
      setChildren(page, h('section', { class: 'inactive' },
        h('h1', null, 'Something went wrong'), h('p', null, err.message),
        h('button', { type: 'button', class: 'btn', onclick: () => { setChildren(page, h('div', { class: 'spinner' })); start(); } }, 'Try again')));
    }
  }
}

start();
