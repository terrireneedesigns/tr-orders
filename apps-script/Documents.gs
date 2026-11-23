/**
 * Documents.gs: quotes and invoices. docs.save, docs.get, docs.list, numbering.
 * Sending, approval, conversion, stages and payments come in later milestones.
 */

var DOC_TYPES = ['quote', 'invoice'];
var FULFILLMENT = ['pickup', 'delivery'];
var DOC_LINE_KINDS = ['base', 'savings', 'upgrade', 'addon', 'custom'];
var MAX_ITEMS = 30;
var MAX_LINES_PER_ITEM = 60;
var MAX_DETAILS_CHARS = 20000;
var CLIENT_ID_RE = /^[A-Za-z0-9_-]{4,40}$/;

/* ---------- save ---------- */

/**
 * docs.save: create or update a quote or invoice.
 * payload: { doc_id?, type, customer_id, fulfillment, est_ready_date, discount_cents, discount_label,
 *   customer_note, internal_notes, upfront_percent,
 *   items: [{ item_id?, product_id, package_id, title, qty, details, lines: [{ line_id?, label, amount_cents, kind, addon_id }] }] }
 * The server recomputes totals and assigns the number on first save. Returns the full document (as docs.get).
 */
function saveDoc_(p) {
  var input = validDoc_(p);
  return withLock_(function () {
    var now = nowIso_();
    var docs = readTable_('Documents');
    var doc;
    if (p.doc_id) {
      doc = findBy_(docs, 'doc_id', vId_(p.doc_id, 'Order'));
      if (!doc) throw appError('NOT_FOUND', 'That order no longer exists.');
      if (doc.status === 'void') throw appError('VALIDATION', 'This order is void and can\'t be changed.');
      if (doc.status === 'converted') throw appError('VALIDATION', 'This quote became an invoice. Edit the invoice instead.');
    }
    if (!findBy_(readTable_('Customers'), 'customer_id', input.customer_id)) {
      throw appError('VALIDATION', 'Please choose a customer.');
    }

    // Keep the ids the app sent (so checklists and patch-spot links stay attached), else make new ones.
    var seen = {};
    var keepId = function (id, prefix) {
      if (typeof id === 'string' && CLIENT_ID_RE.test(id) && !seen[id]) { seen[id] = true; return id; }
      var fresh = newId_(prefix);
      seen[fresh] = true;
      return fresh;
    };
    var items = input.items.map(function (it, i) {
      var itemId = keepId(it.item_id, 'I');
      return {
        item_id: itemId, product_id: it.product_id, package_id: it.package_id, title: it.title,
        qty: it.qty, sort: i + 1, details_json: it.details_json,
        lines: it.lines.map(function (l, j) {
          return {
            line_id: keepId(l.line_id, 'L'), item_id: itemId, label: l.label, amount_cents: l.amount_cents,
            kind: l.kind, addon_id: l.addon_id, sort: j + 1
          };
        })
      };
    });
    var totals = computeTotals_(items, input.discount_cents);

    if (!doc) {
      doc = {
        doc_id: newId_('D'), public_id: newPublicId_(), type: input.type,
        number: nextNumber_(input.type), customer_id: input.customer_id,
        status: 'draft', stage: input.type === 'invoice' ? 'awaiting_payment' : '',
        created_at: now, view_count: 0, paid_cents: 0
      };
      setDocFields_(doc, input, totals, now);
      appendRows_('Documents', [doc]);
      logEvent_('created', doc.doc_id, (input.type === 'quote' ? 'Quote ' : 'Invoice ') + doc.number);
    } else {
      setDocFields_(doc, input, totals, now);
      doc.paid_cents = paidCents_(doc.doc_id);
      updateRow_('Documents', doc);
      deleteRowsWhere_('DocLines', 'doc_id', doc.doc_id);
      deleteRowsWhere_('DocItems', 'doc_id', doc.doc_id);
    }

    appendRows_('DocItems', items.map(function (it) {
      return {
        item_id: it.item_id, doc_id: doc.doc_id, product_id: it.product_id, package_id: it.package_id,
        title: it.title, qty: it.qty, sort: it.sort, details_json: it.details_json
      };
    }));
    var lines = [];
    items.forEach(function (it) {
      it.lines.forEach(function (l) { l.doc_id = doc.doc_id; lines.push(l); });
    });
    appendRows_('DocLines', lines);

    return getDocById_(doc.doc_id);
  });
}

function setDocFields_(doc, input, totals, now) {
  doc.customer_id = input.customer_id;
  doc.fulfillment = input.fulfillment;
  doc.est_ready_date = input.est_ready_date;
  doc.discount_cents = input.discount_cents;
  doc.discount_label = input.discount_label;
  doc.customer_note = input.customer_note;
  doc.internal_notes = input.internal_notes;
  doc.upfront_percent = input.upfront_percent;
  doc.subtotal_cents = totals.subtotal_cents;
  doc.total_cents = totals.total_cents;
  doc.updated_at = now;
}

/** Next Q- or TR- number from Settings (call inside the lock). Numbers are never reused. */
function nextNumber_(type) {
  var key = type === 'quote' ? 'next_quote_no' : 'next_order_no';
  var row = findBy_(readTable_('Settings'), 'key', key);
  if (!row) throw appError('SETUP', 'Numbering settings are missing. Run setup() in Apps Script.');
  var n = parseInt(row.value, 10);
  if (!(n > 0)) n = 1001;
  row.value = String(n + 1);
  updateRow_('Settings', row);
  clearCaches_();
  return (type === 'quote' ? 'Q-' : 'TR-') + n;
}

function paidCents_(docId) {
  return readTable_('Payments').reduce(function (t, pmt) {
    return pmt.doc_id === docId && !pmt.voided ? t + (pmt.amount_cents || 0) : t;
  }, 0);
}

/* ---------- validation ---------- */

function validDoc_(p) {
  var type = vEnum_(p.type, DOC_TYPES, 'Type');
  var estReady = vStr_(p.est_ready_date, 'Ready date', 10);
  if (estReady && !/^\d{4}-\d{2}-\d{2}$/.test(estReady)) throw appError('VALIDATION', 'The ready date isn\'t a valid date.');
  var discount = p.discount_cents === undefined || p.discount_cents === '' ? 0 : vCents_(p.discount_cents, 'Discount');
  if (discount < 0) throw appError('VALIDATION', 'The discount can\'t be negative.');
  var upfront = p.upfront_percent === undefined || p.upfront_percent === '' ? 100 : Number(p.upfront_percent);
  if (!Number.isInteger(upfront) || upfront < 1 || upfront > 100) {
    throw appError('VALIDATION', 'Upfront percent must be a whole number from 1 to 100.');
  }
  if (!Array.isArray(p.items)) throw appError('VALIDATION', 'The items are missing.');
  if (p.items.length > MAX_ITEMS) throw appError('VALIDATION', 'An order can have up to ' + MAX_ITEMS + ' items.');
  if (typeof p.customer_id !== 'string' || !p.customer_id) throw appError('VALIDATION', 'Please choose a customer.');

  var items = p.items.map(function (it, i) {
    var n = i + 1;
    var qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw appError('VALIDATION', 'Item ' + n + ' quantity must be from 1 to 99.');
    if (!Array.isArray(it.lines)) throw appError('VALIDATION', 'Item ' + n + ' lines are missing.');
    if (it.lines.length > MAX_LINES_PER_ITEM) throw appError('VALIDATION', 'Item ' + n + ' has too many lines.');
    var details = it.details === undefined || it.details === null ? {} : it.details;
    if (typeof details !== 'object' || Array.isArray(details)) throw appError('VALIDATION', 'Item ' + n + ' details are not valid.');
    var detailsJson = JSON.stringify(details);
    if (detailsJson.length > MAX_DETAILS_CHARS) throw appError('VALIDATION', 'Item ' + n + ' details are too long.');
    return {
      item_id: it.item_id,
      product_id: vStr_(it.product_id, 'Item ' + n + ' product', 64),
      package_id: vStr_(it.package_id, 'Item ' + n + ' package', 64),
      title: vStr_(it.title, 'Item ' + n + ' title', 200, true),
      qty: qty,
      details_json: detailsJson,
      lines: it.lines.map(function (l, j) {
        var where = 'Item ' + n + ', line ' + (j + 1);
        return {
          line_id: l.line_id,
          label: vStr_(l.label, where + ' description', 200, true),
          amount_cents: vCents_(l.amount_cents, where + ' amount'),
          kind: vEnum_(l.kind || 'custom', DOC_LINE_KINDS, where + ' type'),
          addon_id: vStr_(l.addon_id, where + ' add-on', 64)
        };
      })
    };
  });

  return {
    type: type,
    customer_id: p.customer_id,
    fulfillment: vEnum_(p.fulfillment || 'pickup', FULFILLMENT, 'Pickup or delivery'),
    est_ready_date: estReady,
    discount_cents: discount,
    discount_label: vStr_(p.discount_label, 'Discount label', 100),
    customer_note: vStr_(p.customer_note, 'Note to customer', 5000),
    internal_notes: vStr_(p.internal_notes, 'Internal notes', 5000),
    upfront_percent: upfront,
    items: items
  };
}

/* ---------- get ---------- */

/** docs.get: { doc_id } or { number } -> the full document for the admin app. */
function getDoc_(p) {
  var docs = readTable_('Documents');
  var doc = p.doc_id ? findBy_(docs, 'doc_id', String(p.doc_id))
    : p.number ? findBy_(docs, 'number', String(p.number).toUpperCase()) : null;
  if (!doc) throw appError('NOT_FOUND', 'That order wasn\'t found.');
  return getDocById_(doc.doc_id, doc);
}

function getDocById_(docId, docRow) {
  var doc = docRow || findBy_(readTable_('Documents'), 'doc_id', docId);
  var lines = readTable_('DocLines').filter(function (l) { return l.doc_id === docId; }).sort(bySort_);
  var items = readTable_('DocItems').filter(function (it) { return it.doc_id === docId; }).sort(bySort_)
    .map(function (it) {
      var out = clean_(it);
      try { out.details = JSON.parse(it.details_json || '{}'); } catch (err) { out.details = {}; }
      delete out.details_json;
      out.lines = lines.filter(function (l) { return l.item_id === it.item_id; }).map(clean_);
      return out;
    });
  var customer = findBy_(readTable_('Customers'), 'customer_id', doc.customer_id);
  var now = Date.now();
  var out = clean_(doc);
  out.effective_status = effectiveStatus_(doc, now);
  out.flags = docFlags_(doc, items.length, getSettings_(), now);
  out.amount_due_cents = amountDueNow_(doc);
  out.payment_status = paymentStatus_(doc.paid_cents, doc.total_cents);
  return {
    doc: out,
    customer: customer ? clean_(customer) : null,
    items: items,
    payments: readTable_('Payments').filter(function (x) { return x.doc_id === docId; }).map(clean_),
    checklist: readTable_('Checklist').filter(function (x) { return x.doc_id === docId; }).map(clean_),
    photos: readTable_('Photos').filter(function (x) { return x.doc_id === docId; }).map(clean_),
    log: readTable_('Log').filter(function (x) { return x.doc_id === docId; }).map(clean_)
  };
}

/* ---------- list ---------- */

var LIST_FILTERS = ['all', 'quotes', 'unpaid', 'in_progress', 'ready', 'completed'];

/**
 * docs.list: { filter, q, offset, limit } -> { rows, total }. Newest first.
 * Rows are summaries for the Orders list (no notes, no lines).
 */
function listDocs_(p) {
  var filter = LIST_FILTERS.indexOf(p.filter) === -1 ? 'all' : p.filter;
  var q = String(p.q || '').trim().toLowerCase().slice(0, 100);
  var digits = q.replace(/\D/g, '');
  var offset = Math.max(0, parseInt(p.offset, 10) || 0);
  var limit = Math.min(100, Math.max(1, parseInt(p.limit, 10) || 50));

  var customers = {};
  readTable_('Customers').forEach(function (c) { customers[c.customer_id] = c; });
  var itemCounts = {};
  readTable_('DocItems').forEach(function (it) { itemCounts[it.doc_id] = (itemCounts[it.doc_id] || 0) + 1; });
  var settings = getSettings_();
  var now = Date.now();

  var rows = readTable_('Documents').map(function (d) {
    var c = customers[d.customer_id] || {};
    var status = effectiveStatus_(d, now);
    return {
      doc_id: d.doc_id, number: d.number, type: d.type, status: d.status, effective_status: status, stage: d.stage,
      customer_id: d.customer_id, customer_name: c.name || '', customer_phone: c.phone || '',
      total_cents: d.total_cents, paid_cents: d.paid_cents, amount_due_cents: amountDueNow_(d),
      created_at: d.created_at, updated_at: d.updated_at, sent_at: d.sent_at, first_viewed_at: d.first_viewed_at,
      flags: docFlags_(d, itemCounts[d.doc_id] || 0, settings, now)
    };
  }).filter(function (r) {
    var live = r.status !== 'void' && r.stage !== 'cancelled';
    switch (filter) {
      case 'quotes': return r.type === 'quote' && r.status !== 'converted';
      case 'unpaid': return r.type === 'invoice' && live && r.paid_cents < r.total_cents;
      case 'in_progress': return r.type === 'invoice' && live && r.stage === 'in_progress';
      case 'ready': return r.type === 'invoice' && live && r.stage === 'ready';
      case 'completed': return r.type === 'invoice' && r.stage === 'completed';
      default: return true;
    }
  }).filter(function (r) {
    if (!q) return true;
    return r.number.toLowerCase().indexOf(q) !== -1 ||
      r.customer_name.toLowerCase().indexOf(q) !== -1 ||
      (digits.length >= 3 && r.customer_phone.replace(/\D/g, '').indexOf(digits) !== -1);
  }).sort(function (a, b) { return isoMs_(b.created_at) - isoMs_(a.created_at); });

  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

/* ---------- sending and conversion ---------- */

/**
 * docs.markSent: { doc_id, method: 'manual' | 'share' } records that the link was sent.
 * Quotes: draft -> sent, expires quote_expiry_days later. Invoices: draft -> issued.
 * Sending again (resend) keeps the first sent date.
 */
function markSent_(p) {
  var id = vId_(p.doc_id, 'Order');
  var method = vEnum_(p.method || 'manual', ['manual', 'share'], 'How it was sent');
  return withLock_(function () {
    var doc = findBy_(readTable_('Documents'), 'doc_id', id);
    if (!doc) throw appError('NOT_FOUND', 'That order no longer exists.');
    if (doc.status === 'void' || doc.status === 'converted') throw appError('VALIDATION', 'This order can\'t be sent.');
    if (!readTable_('DocItems').some(function (it) { return it.doc_id === id; })) {
      throw appError('VALIDATION', 'Add at least one item before sending.');
    }
    var now = nowIso_();
    if (!doc.sent_at) {
      doc.sent_at = now;
      if (doc.type === 'quote') doc.expires_at = addDaysIso_(Number(getSettings_().quote_expiry_days) || 30);
    }
    doc.sent_method = method;
    if (doc.status === 'draft') doc.status = doc.type === 'quote' ? 'sent' : 'issued';
    doc.updated_at = now;
    updateRow_('Documents', doc);
    logEvent_('sent', doc.doc_id, method === 'share' ? 'Sent from the app' : 'Marked as sent');
    return getDocById_(doc.doc_id);
  });
}

/**
 * Turn a quote into a new invoice (call inside the lock). Copies items, lines, details, customer,
 * fulfillment, notes, discount and upfront percent, with a new TR- number and new ids.
 * opts.sentMethod: 'customer_approved' marks the invoice as already sent (the customer is looking at it).
 * Returns the new invoice row; the quote becomes "converted".
 */
function convertQuote_(quote, opts) {
  var now = nowIso_();
  var items = readTable_('DocItems').filter(function (it) { return it.doc_id === quote.doc_id; }).sort(bySort_);
  var lines = readTable_('DocLines').filter(function (l) { return l.doc_id === quote.doc_id; }).sort(bySort_);
  var invoice = {
    doc_id: newId_('D'), public_id: newPublicId_(), type: 'invoice', number: nextNumber_('invoice'),
    customer_id: quote.customer_id, status: opts.sentMethod ? 'issued' : 'draft', stage: 'awaiting_payment',
    fulfillment: quote.fulfillment, created_at: now, updated_at: now,
    sent_at: opts.sentMethod ? now : '', sent_method: opts.sentMethod || '',
    view_count: 0, from_quote_id: quote.doc_id, est_ready_date: quote.est_ready_date,
    upfront_percent: quote.upfront_percent || 100, discount_cents: quote.discount_cents || 0,
    discount_label: quote.discount_label, subtotal_cents: quote.subtotal_cents, total_cents: quote.total_cents,
    paid_cents: 0, customer_note: quote.customer_note, internal_notes: quote.internal_notes
  };
  var lineMap = {};
  var newItems = items.map(function (it) {
    var itemId = newId_('I');
    var itemLines = lines.filter(function (l) { return l.item_id === it.item_id; }).map(function (l) {
      var lineId = newId_('L');
      lineMap[l.line_id] = lineId;
      return { line_id: lineId, item_id: itemId, doc_id: invoice.doc_id, label: l.label, amount_cents: l.amount_cents, kind: l.kind, addon_id: l.addon_id, sort: l.sort };
    });
    return { row: { item_id: itemId, doc_id: invoice.doc_id, product_id: it.product_id, package_id: it.package_id, title: it.title, qty: it.qty, sort: it.sort, details_json: it.details_json }, lines: itemLines };
  });
  // Extra patch spots point at their price line; point them at the copied line.
  newItems.forEach(function (ni) {
    try {
      var d = JSON.parse(ni.row.details_json || '{}');
      if (Array.isArray(d.spots)) {
        d.spots.forEach(function (s) { if (s.line_id && lineMap[s.line_id]) s.line_id = lineMap[s.line_id]; });
        ni.row.details_json = JSON.stringify(d);
      }
    } catch (err) { /* leave details as they were */ }
  });
  var totals = computeTotals_(newItems.map(function (ni) { return { qty: ni.row.qty, lines: ni.lines }; }), invoice.discount_cents);
  invoice.subtotal_cents = totals.subtotal_cents;
  invoice.total_cents = totals.total_cents;

  appendRows_('Documents', [invoice]);
  appendRows_('DocItems', newItems.map(function (ni) { return ni.row; }));
  appendRows_('DocLines', [].concat.apply([], newItems.map(function (ni) { return ni.lines; })));

  quote.status = 'converted';
  quote.converted_invoice_id = invoice.doc_id;
  quote.updated_at = now;
  updateRow_('Documents', quote);
  logEvent_('converted', quote.doc_id, 'Became invoice ' + invoice.number);
  logEvent_('created', invoice.doc_id, 'Invoice ' + invoice.number + ' from quote ' + quote.number);
  return invoice;
}
