// rules.js: business rules as pure functions (SPEC section 5). Unit tested in tests/rules.test.html.
// The server (apps-script/Rules.gs) recomputes totals and flags and is authoritative; keep the two in step.

export const DAY_MS = 86400000;

/* ---------- totals (5.1, 5.2, 5.3) ---------- */

export function itemUnitCents(lines) {
  return lines.reduce((t, l) => t + (Number(l.amount_cents) || 0), 0);
}

export function itemTotalCents(item) {
  return itemUnitCents(item.lines) * (Number(item.qty) || 0);
}

export function computeTotals(items, discountCents = 0) {
  const subtotal = items.reduce((t, it) => t + itemTotalCents(it), 0);
  return { subtotal_cents: subtotal, total_cents: Math.max(0, subtotal - (Number(discountCents) || 0)) };
}

/** Upfront amount, rounded up to the cent. */
export function upfrontCents(totalCents, percent = 100) {
  let p = Number(percent);
  if (!(p >= 0)) p = 100;
  return Math.ceil((totalCents * p) / 100);
}

export function amountDueNow(doc) {
  const upfront = upfrontCents(doc.total_cents, doc.upfront_percent);
  const paid = doc.paid_cents || 0;
  if (paid < upfront) return upfront - paid;
  if (doc.stage === 'ready' || doc.stage === 'completed') return Math.max(0, doc.total_cents - paid);
  return 0;
}

export function paymentStatus(paid, total) {
  if (!paid) return 'unpaid';
  return paid >= total ? 'paid' : 'partial';
}

/* ---------- statuses and flags (5.4, 5.5, 5.6) ---------- */

const ms = (iso) => {
  const t = iso ? new Date(iso).getTime() : 0;
  return isNaN(t) ? 0 : t;
};

/** A sent quote past its expiry reads as "expired". */
export function effectiveStatus(doc, now = Date.now()) {
  if (doc.type === 'quote' && doc.status === 'sent' && doc.expires_at && ms(doc.expires_at) < now) return 'expired';
  return doc.status;
}

export function docFlags(doc, itemCount, settings = {}, now = Date.now()) {
  const status = effectiveStatus(doc, now);
  const paid = doc.paid_cents || 0;
  const upfront = upfrontCents(doc.total_cents, doc.upfront_percent);
  const unpaidDays = Number(settings.unpaid_flag_days) || 7;
  const readyDays = Number(settings.ready_flag_days) || 3;
  const closed = ['void', 'converted', 'declined', 'expired'].includes(status) || doc.stage === 'cancelled';
  const readyLate = doc.stage === 'ready' && !!doc.ready_at && ms(doc.ready_at) + readyDays * DAY_MS < now;
  return {
    not_sent: itemCount > 0 && !doc.sent_at && !closed,
    viewed: !!doc.first_viewed_at,
    overdue: doc.type === 'invoice' && doc.status === 'issued' && doc.stage !== 'cancelled' && !!doc.sent_at &&
      ms(doc.sent_at) + unpaidDays * DAY_MS < now && paid < upfront,
    ready_late: readyLate,
    balance_overdue: readyLate && paid < doc.total_cents,
    quote_waiting: doc.type === 'quote' && status === 'sent',
    quote_expiring: doc.type === 'quote' && status === 'sent' && !!doc.expires_at && ms(doc.expires_at) - now < 5 * DAY_MS
  };
}

/** Plain-words status and badge style for lists and headers (SPEC 13.1 badge colors). */
export function statusInfo(doc, now = Date.now()) {
  const status = doc.effective_status || effectiveStatus(doc, now);
  if (doc.type === 'quote') {
    return {
      draft: { label: 'Draft', badge: 'draft' }, sent: { label: 'Sent', badge: 'sent' },
      approved: { label: 'Approved', badge: 'paid' }, declined: { label: 'Declined', badge: 'closed' },
      expired: { label: 'Expired', badge: 'closed' }, converted: { label: 'Converted', badge: 'closed' }
    }[status] || { label: status, badge: 'draft' };
  }
  if (status === 'void') return { label: 'Void', badge: 'closed' };
  if (status === 'draft') return { label: 'Draft', badge: 'draft' };
  return {
    awaiting_payment: { label: 'Awaiting payment', badge: 'sent' }, in_progress: { label: 'In progress', badge: 'progress' },
    ready: { label: 'Ready', badge: 'ready' }, completed: { label: 'Completed', badge: 'paid' },
    cancelled: { label: 'Cancelled', badge: 'closed' }
  }[doc.stage] || { label: doc.stage || 'Draft', badge: 'draft' };
}

/* ---------- jacket rules (5.8) ---------- */

/** The 4 patch spots every jacket package includes. Left and right are the wearer's. */
export const INCLUDED_SPOTS = [
  { key: 'back', label: 'Back (main)', hint: 'Up to about 10 in wide' },
  { key: 'left_chest', label: 'Left chest', hint: 'Up to about 3.5 in' },
  { key: 'right_chest', label: 'Right chest', hint: 'Up to about 3.5 in' },
  { key: 'sleeve', label: 'Sleeve', hint: 'Up to about 3 in' }
];
export const MAX_EXTRAS = 3; // 7 patches in all

export function newJacketDetails() {
  return {
    style: '', size: '', color: '', order_type: '', airbrushed: false, design_text: '', regalia: '',
    spots: INCLUDED_SPOTS.map((s) => ({ key: s.key, patch_no: '', own_patch: false, notes: '', side: s.key === 'sleeve' ? 'right' : undefined })),
    notes: ''
  };
}

/** "Extra A", "Extra B", ... for the nth extra spot (0-based). */
export function extraLabel(n) {
  return 'Extra ' + String.fromCharCode(65 + n);
}

export function extraSpots(details) {
  return (details.spots || []).filter((s) => s.key.startsWith('extra'));
}

/** True when adding another extra spot goes past 3 extras (7 patches): ask first, but allow. */
export function needsCustomQuoteWarning(details) {
  return extraSpots(details).length >= MAX_EXTRAS;
}

/**
 * Left sleeve rule: sleeve on the Left adds the left-sleeve add-on line once; Right removes it.
 * Returns a new lines array. `addOn` is the product's add-on with rule "left_sleeve" (or null).
 */
export function applyLeftSleeve(lines, side, addOn, makeId = () => '') {
  if (!addOn) return lines;
  const has = lines.some((l) => l.addon_id === addOn.addon_id);
  if (side === 'left' && !has) {
    return lines.concat([{ line_id: makeId(), label: addOn.label, amount_cents: addOn.amount_cents, kind: 'addon', addon_id: addOn.addon_id }]);
  }
  if (side !== 'left' && has) return lines.filter((l) => l.addon_id !== addOn.addon_id);
  return lines;
}

/** An item counts as a Standard package when it has no upgrade line. */
export function isStandardItem(lines) {
  return !lines.some((l) => l.kind === 'upgrade');
}

/**
 * Soft tier warnings: a Premium patch in an included spot on a Standard package.
 * Returns [{ spot, patch, message }]. Never blocks saving.
 */
export function tierWarnings(details, lines, patches) {
  if (!details || !details.spots || !isStandardItem(lines)) return [];
  const included = new Set(INCLUDED_SPOTS.map((s) => s.key));
  const out = [];
  for (const spot of details.spots) {
    if (!included.has(spot.key) || !spot.patch_no || spot.own_patch) continue;
    const patch = patches.find((p) => p.patch_no === spot.patch_no);
    if (patch && patch.tier === 'premium') {
      out.push({ spot, patch, message: 'No. ' + patch.patch_no + ' is a Premium patch. Change to Premium package or add an upgrade?' });
    }
  }
  return out;
}
