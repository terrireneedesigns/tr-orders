/**
 * Public.gs: the customer page actions (no sign-in). SPEC 8 and 10.
 * Everything is looked up by public_id only, and only fields on the explicit allow-list below
 * are ever returned: never internal notes, other customers, ids, photos or contact details.
 */

var SPOT_LABELS = { back: 'Back', left_chest: 'Left chest', right_chest: 'Right chest', sleeve: 'Sleeve' };

function inactiveLinkError_() {
  var s = getSettings_();
  return appError('NOT_FOUND', 'This link is no longer active. Please contact ' + (s.business_name || 'us') +
    (s.phone ? ' at ' + s.phone : '') + '.');
}

function validPublicId_(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{24,64}$/.test(id)) throw inactiveLinkError_();
  return id;
}

/** True when the request carries a valid admin session (Terri previewing). Never throws. */
function isAdmin_(token) {
  if (!token) return false;
  try { requireSession_(token); return true; } catch (err) { return false; }
}

/**
 * public.getDocument: { public_id, preview? } -> customer-safe document.
 * Records a view unless it is Terri (admin token or preview=1). Drafts and void documents
 * are refused, except to Terri. An old quote link that became an invoice shows the invoice.
 */
function publicGetDocument_(p, ctx) {
  var id = validPublicId_(p.public_id);
  var admin = isAdmin_(ctx.token);
  var countView = !admin && !p.preview;
  return withLock_(function () {
    var docs = readTable_('Documents');
    var doc = findBy_(docs, 'public_id', id);
    if (!doc) throw inactiveLinkError_();
    if (doc.type === 'quote' && doc.status === 'converted' && doc.converted_invoice_id) {
      var inv = findBy_(docs, 'doc_id', doc.converted_invoice_id);
      if (inv && inv.status !== 'void') doc = inv;
    }
    if (doc.status === 'void' || (doc.status === 'draft' && !admin)) throw inactiveLinkError_();
    if (countView) {
      var now = nowIso_();
      if (!doc.first_viewed_at) {
        doc.first_viewed_at = now;
        logEvent_('viewed', doc.doc_id, 'Customer opened the link');
      }
      doc.last_viewed_at = now;
      doc.view_count = (doc.view_count || 0) + 1;
      updateRow_('Documents', doc);
    }
    return publicDoc_(doc, docs);
  });
}

/** public.approveQuote: { public_id, name, terms_accepted } -> the new invoice (customer-safe). */
function publicApproveQuote_(p) {
  var id = validPublicId_(p.public_id);
  var name = vStr_(p.name, 'Your full name', 100, true);
  if (p.terms_accepted !== true) throw appError('VALIDATION', 'Please tick the box to agree to the terms.');
  return withLock_(function () {
    var docs = readTable_('Documents');
    var quote = findBy_(docs, 'public_id', id);
    if (!quote || quote.type !== 'quote' || quote.status === 'void' || quote.status === 'draft') throw inactiveLinkError_();
    var status = effectiveStatus_(quote, Date.now());
    if (status === 'expired') throw appError('VALIDATION', 'This quote has expired. Contact us to renew it.');
    if (status !== 'sent') throw appError('VALIDATION', 'This quote can no longer be approved.');
    quote.approved_at = nowIso_();
    quote.approved_name = name;
    quote.terms_accepted = true;
    quote.status = 'approved';
    updateRow_('Documents', quote);
    logEvent_('approved', quote.doc_id, 'Approved by ' + name);
    var invoice = convertQuote_(quote, { sentMethod: 'customer_approved' });
    return publicDoc_(invoice, readTable_('Documents'));
  });
}

/** public.declineQuote: { public_id, note? } */
function publicDeclineQuote_(p) {
  var id = validPublicId_(p.public_id);
  var note = vStr_(p.note, 'Note', 1000);
  return withLock_(function () {
    var docs = readTable_('Documents');
    var quote = findBy_(docs, 'public_id', id);
    if (!quote || quote.type !== 'quote' || quote.status === 'void' || quote.status === 'draft') throw inactiveLinkError_();
    if (effectiveStatus_(quote, Date.now()) !== 'sent') throw appError('VALIDATION', 'This quote can no longer be declined.');
    quote.status = 'declined';
    quote.declined_at = nowIso_();
    quote.decline_note = note;
    quote.updated_at = quote.declined_at;
    updateRow_('Documents', quote);
    logEvent_('declined', quote.doc_id, note ? 'Declined: ' + note : 'Declined');
    return publicDoc_(quote, docs);
  });
}

/* ---------- allow-list serializer ---------- */

function publicDoc_(doc, docs) {
  var s = getSettings_();
  var customer = findBy_(readTable_('Customers'), 'customer_id', doc.customer_id);
  var patches = {};
  getCatalog_().patches.forEach(function (pt) { patches[pt.patch_no] = pt.name; });
  var lines = readTable_('DocLines').filter(function (l) { return l.doc_id === doc.doc_id; }).sort(bySort_);
  var items = readTable_('DocItems').filter(function (it) { return it.doc_id === doc.doc_id; }).sort(bySort_)
    .map(function (it) {
      var details = {};
      try { details = JSON.parse(it.details_json || '{}'); } catch (err) { details = {}; }
      return {
        title: it.title,
        qty: it.qty,
        lines: lines.filter(function (l) { return l.item_id === it.item_id; })
          .map(function (l) { return { label: l.label, amount_cents: l.amount_cents }; }),
        details: publicDetails_(details, patches)
      };
    });
  var payments = readTable_('Payments')
    .filter(function (x) { return x.doc_id === doc.doc_id && !x.voided; })
    .sort(function (a, b) { return String(a.paid_on).localeCompare(String(b.paid_on)); })
    .map(function (x) { return { paid_on: x.paid_on, amount_cents: x.amount_cents, method: x.method }; });
  var fromQuote = doc.from_quote_id ? findBy_(docs, 'doc_id', doc.from_quote_id) : null;
  var now = Date.now();
  return {
    business: {
      name: s.business_name, phone: s.phone, email: s.email, website: s.website,
      zelle_contact: s.zelle_contact, zelle_display_name: s.zelle_display_name,
      terms_title: s.terms_title, terms: s.terms
    },
    doc: {
      public_id: doc.public_id, type: doc.type, number: doc.number,
      status: effectiveStatus_(doc, now), stage: doc.stage, fulfillment: doc.fulfillment,
      created_at: doc.created_at, sent_at: doc.sent_at, expires_at: doc.expires_at,
      approved_at: doc.approved_at, approved_name: doc.approved_name, declined_at: doc.declined_at,
      est_ready_date: doc.est_ready_date, upfront_percent: doc.upfront_percent || 100,
      discount_cents: doc.discount_cents || 0, discount_label: doc.discount_label,
      subtotal_cents: doc.subtotal_cents, total_cents: doc.total_cents, paid_cents: doc.paid_cents || 0,
      upfront_cents: upfrontCents_(doc.total_cents, doc.upfront_percent),
      amount_due_cents: amountDueNow_(doc), payment_status: paymentStatus_(doc.paid_cents || 0, doc.total_cents),
      customer_note: doc.customer_note, from_quote_number: fromQuote ? fromQuote.number : ''
    },
    customer: { name: customer ? customer.name : '' },
    items: items,
    payments: payments
  };
}

/** Customer-facing parts of an item's details, with patch names and plain spot labels. */
function publicDetails_(d, patches) {
  if (!Array.isArray(d.spots)) return { notes: d.notes || '' };
  var extraN = 0;
  var spots = d.spots.map(function (sp) {
    var label;
    if (SPOT_LABELS[sp.key]) {
      label = SPOT_LABELS[sp.key] + (sp.key === 'sleeve' ? ' (' + (sp.side === 'left' ? 'left' : 'right') + ')' : '');
    } else {
      label = 'Extra ' + String.fromCharCode(65 + extraN++) + (sp.where ? ' (' + sp.where + ')' : '');
    }
    return {
      label: label, patch_no: sp.patch_no || '', patch_name: sp.patch_no ? (patches[sp.patch_no] || '') : '',
      own_patch: !!sp.own_patch, notes: sp.notes || ''
    };
  }).filter(function (sp) { return sp.patch_no || sp.own_patch || sp.notes; });
  return {
    style: d.style === 'mens' ? 'Men\'s' : d.style === 'womens' ? 'Women\'s' : '',
    size: d.size || '', color: d.color || '',
    order_type: { freemason: 'Freemason', oes: 'OES', other: 'Other' }[d.order_type] || '',
    airbrushed: !!d.airbrushed, design_text: d.airbrushed ? (d.design_text || '') : '',
    regalia: d.regalia || '', spots: spots, notes: d.notes || ''
  };
}
