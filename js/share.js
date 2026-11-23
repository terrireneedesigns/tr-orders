// share.js: send a quote, invoice, receipt or "ready" message (SPEC 7).
// Uses the iPhone share menu (Web Share); on computers it offers Copy link, Text and Email.
// After a quote or invoice is shared, asks "Did you send it?" so "sent" is only recorded when it was.
import { h, sheet, confirmDialog, toast, showError, copyToClipboard, showTextToCopy } from './ui.js';
import { call } from './api.js';
import { BASE_URL } from './config.js';
import { formatCents } from './money.js';

/** The customer's link. With preview, Terri's own visit isn't counted as a view. */
export function customerLink(doc, preview = false) {
  return BASE_URL + 'view.html?id=' + encodeURIComponent(doc.public_id) + (preview ? '&preview=1' : '');
}

const DEFAULTS = {
  quote: 'Hi {first_name}, here is your quote {number} from Terri Renee Evolvé. Review and approve here: {link}',
  invoice: 'Hi {first_name}, here is your invoice {number} from Terri Renee Evolvé for {total}. Payment details are on the page: {link}',
  receipt: 'Thank you, {first_name}! Your payment for {number} is received: {link}',
  ready: 'Hi {first_name}, your order {number} is ready! {fulfillment_text}'
};

/** Message text from the Settings template, with {placeholders} filled in. */
export function messageFor(kind, doc, customer, settings) {
  const tpl = (settings && settings['msg_' + kind]) || DEFAULTS[kind];
  const name = (customer && customer.name) || '';
  const values = {
    first_name: name.trim().split(/\s+/)[0] || 'there',
    name: name || 'there',
    number: doc.number,
    total: formatCents(doc.total_cents),
    amount_due: formatCents(doc.amount_due_cents || 0),
    link: customerLink(doc),
    fulfillment_text: doc.fulfillment === 'delivery' ? 'We\'ll be in touch to arrange delivery.' : 'It\'s ready for pickup.'
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}

function subjectFor(kind, doc) {
  return {
    quote: 'Your quote ' + doc.number + ' from Terri Renee Evolvé',
    invoice: 'Your invoice ' + doc.number + ' from Terri Renee Evolvé',
    receipt: 'Payment received for ' + doc.number,
    ready: 'Your order ' + doc.number + ' is ready'
  }[kind];
}

/**
 * Send a message. Call straight from a tap (the share menu needs a fresh tap: no waiting first).
 * kind: 'quote' | 'invoice' | 'receipt' | 'ready'. For quote/invoice, `onSent()` runs after
 * Terri confirms "Yes, sent" (it records sent_at).
 */
export function sendMessage({ kind, doc, customer, settings, onSent }) {
  const text = messageFor(kind, doc, customer, settings);
  const asks = kind === 'quote' || kind === 'invoice';
  const afterSend = async () => {
    if (!asks) return;
    const yes = await confirmDialog({ title: 'Did you send it?', message: 'Tap "Yes, sent" once the message has gone to ' + ((customer && customer.name) || 'the customer') + '.', yes: 'Yes, sent', no: 'Not yet' });
    if (yes && onSent) {
      try { await onSent(); } catch (err) { showError(err); }
    }
  };
  if (navigator.share) {
    // The link is already in the text; passing it again as `url` makes some apps show it twice.
    navigator.share({ title: subjectFor(kind, doc), text })
      .then(afterSend)
      .catch((err) => {
        if (err && err.name === 'AbortError') return; // closed the share menu: don't ask
        fallbackSheet({ kind, doc, customer, text, afterSend });
      });
  } else {
    fallbackSheet({ kind, doc, customer, text, afterSend });
  }
}

/** Computers (no share menu): Copy link, Text and Email. */
function fallbackSheet({ kind, doc, customer, text, afterSend }) {
  const phone = ((customer && customer.phone) || '').replace(/[^\d+]/g, '');
  const email = (customer && customer.email) || '';
  const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  const smsHref = 'sms:' + phone + (isApple ? '&' : '?') + 'body=' + encodeURIComponent(text);
  const mailHref = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subjectFor(kind, doc)) + '&body=' + encodeURIComponent(text);
  sheet((close) => {
    const done = () => { close(); setTimeout(afterSend, 300); };
    const copyMsg = h('button', { type: 'button', class: 'btn btn-block' }, 'Copy message');
    copyMsg.addEventListener('click', async () => {
      if (await copyToClipboard(text)) { toast('Message copied. Paste it into a text or email.'); done(); return; }
      close();
      showTextToCopy('Copy this message', text, afterSend);
    });
    return [
      h('h2', null, 'Send ' + doc.number),
      h('p', { class: 'card small notes' }, text),
      h('div', { class: 'actions' },
        copyMsg,
        phone ? h('a', { class: 'btn btn-secondary btn-block', href: smsHref, onclick: done }, 'Text ' + customer.phone) : null,
        email ? h('a', { class: 'btn btn-secondary btn-block', href: mailHref, onclick: done }, 'Email ' + email) : null,
        h('button', { type: 'button', class: 'btn-link', onclick: () => close() }, 'Cancel'))
    ];
  });
}

/** Record that a quote or invoice was sent through the app. */
export async function recordShared(doc) {
  const res = await call('docs.markSent', { doc_id: doc.doc_id, method: 'share' });
  toast('Marked as sent');
  return res;
}
