/**
 * Rules.gs: totals, payment status and flags (SPEC section 5), mirrored from js/rules.js.
 * The server is authoritative: totals are recomputed here on every save.
 * Keep the two copies in step; both are covered by tests.
 */

var DAY_MS = 86400000;

function itemUnitCents_(lines) {
  return lines.reduce(function (t, l) { return t + (Number(l.amount_cents) || 0); }, 0);
}

/** items: [{ qty, lines: [{ amount_cents }] }] -> { subtotal_cents, total_cents } */
function computeTotals_(items, discountCents) {
  var subtotal = items.reduce(function (t, it) {
    return t + itemUnitCents_(it.lines) * (Number(it.qty) || 0);
  }, 0);
  return { subtotal_cents: subtotal, total_cents: Math.max(0, subtotal - (Number(discountCents) || 0)) };
}

/** Rounded up to the cent (5.2). */
function upfrontCents_(totalCents, percent) {
  var p = Number(percent);
  if (!(p >= 0)) p = 100;
  return Math.ceil(totalCents * p / 100);
}

function amountDueNow_(doc) {
  var upfront = upfrontCents_(doc.total_cents, doc.upfront_percent);
  var paid = doc.paid_cents || 0;
  if (paid < upfront) return upfront - paid;
  if (doc.stage === 'ready' || doc.stage === 'completed') return Math.max(0, doc.total_cents - paid);
  return 0;
}

function paymentStatus_(paid, total) {
  if (!paid) return 'unpaid';
  return paid >= total ? 'paid' : 'partial';
}

/** A sent quote whose expiry date has passed reads as "expired" (computed, never stored). */
function effectiveStatus_(doc, now) {
  if (doc.type === 'quote' && doc.status === 'sent' && doc.expires_at && isoMs_(doc.expires_at) < now) return 'expired';
  return doc.status;
}

/**
 * Flags (5.6), derived on every read. `itemCount` is how many items the document has.
 * settings needs unpaid_flag_days and ready_flag_days.
 */
function docFlags_(doc, itemCount, settings, now) {
  var status = effectiveStatus_(doc, now);
  var paid = doc.paid_cents || 0;
  var upfront = upfrontCents_(doc.total_cents, doc.upfront_percent);
  var unpaidDays = Number(settings.unpaid_flag_days) || 7;
  var readyDays = Number(settings.ready_flag_days) || 3;
  var closed = status === 'void' || status === 'converted' || status === 'declined' || status === 'expired' ||
    doc.stage === 'cancelled';
  var readyLate = doc.stage === 'ready' && !!doc.ready_at && isoMs_(doc.ready_at) + readyDays * DAY_MS < now;
  return {
    not_sent: itemCount > 0 && !doc.sent_at && !closed,
    viewed: !!doc.first_viewed_at,
    overdue: doc.type === 'invoice' && doc.status === 'issued' && doc.stage !== 'cancelled' && !!doc.sent_at &&
      isoMs_(doc.sent_at) + unpaidDays * DAY_MS < now && paid < upfront,
    ready_late: readyLate,
    balance_overdue: readyLate && paid < doc.total_cents,
    quote_waiting: doc.type === 'quote' && status === 'sent',
    quote_expiring: doc.type === 'quote' && status === 'sent' && !!doc.expires_at &&
      isoMs_(doc.expires_at) - now < 5 * DAY_MS
  };
}

/* ---------- shop checklists (SPEC 6.8) ---------- */

var CHECKLIST_STEPS = {
  jacket: ['Patches and placement approved, paid in full', 'Jacket and patches in', 'Lining opened', 'Patches sewn on',
    'Lining closed, checked', 'Pressed', 'Final check', 'Picked up or delivered'],
  simple: ['Details approved, paid in full', 'Materials in', 'Work done', 'Final check', 'Picked up or delivered']
};

function checklistSteps_(detailForm) {
  return CHECKLIST_STEPS[detailForm] || CHECKLIST_STEPS.simple;
}

/**
 * Checklist for each item of an invoice: template steps merged with the done dates saved in the
 * Checklist tab. Rows are only stored once a step is ticked, so editing items never breaks it.
 * Returns [{ item_id, title, final_step, steps: [{ step_no, label, done_at }] }].
 */
function progressFor_(items, rows, products) {
  var formOf = {};
  products.forEach(function (p) { formOf[p.product_id] = p.detail_form; });
  return items.map(function (it) {
    var labels = checklistSteps_(formOf[it.product_id]);
    return {
      item_id: it.item_id, title: it.title, final_step: labels.length - 1,
      steps: labels.map(function (label, i) {
        var row = rows.filter(function (r) { return r.item_id === it.item_id && r.step_no === i + 1; })[0];
        return { step_no: i + 1, label: label, done_at: row ? row.done_at : '' };
      })
    };
  });
}
