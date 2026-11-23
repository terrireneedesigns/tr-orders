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
  var linked = function (id) {
    var d = id ? findBy_(readTable_('Documents'), 'doc_id', id) : null;
    return d ? d.number : '';
  };
  out.from_quote_number = linked(doc.from_quote_id);
  out.converted_invoice_number = linked(doc.converted_invoice_id);
  out.upfront_cents = upfrontCents_(doc.total_cents, doc.upfront_percent);
  out.effective_status = effectiveStatus_(doc, now);
  out.flags = docFlags_(doc, items.length, getSettings_(), now);
  out.amount_due_cents = amountDueNow_(doc);
  out.payment_status = paymentStatus_(doc.paid_cents, doc.total_cents);
  return {
    doc: out,
    customer: customer ? clean_(customer) : null,
    items: items,
    payments: readTable_('Payments').filter(function (x) { return x.doc_id === docId; }).map(clean_),
    progress: doc.type === 'invoice'
      ? progressFor_(items, readTable_('Checklist').filter(function (x) { return x.doc_id === docId; }), getCatalog_().products)
      : [],
    photos: readTable_('Photos').filter(function (x) { return x.doc_id === docId; }).map(clean_),
    log: readTable_('Log').filter(function (x) { return x.doc_id === docId; }).map(clean_).reverse()
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
 * Copy one document's items and lines to another document id, with new ids.
 * Extra patch spots that point at a price line are pointed at the copied line.
 * Returns { items: [rows], lines: [rows], totals } (not yet written).
 */
function copyItems_(fromDocId, toDocId, discountCents) {
  var items = readTable_('DocItems').filter(function (it) { return it.doc_id === fromDocId; }).sort(bySort_);
  var lines = readTable_('DocLines').filter(function (l) { return l.doc_id === fromDocId; }).sort(bySort_);
  var lineMap = {};
  var outItems = [];
  var outLines = [];
  items.forEach(function (it) {
    var itemId = newId_('I');
    var mine = lines.filter(function (l) { return l.item_id === it.item_id; }).map(function (l) {
      var lineId = newId_('L');
      lineMap[l.line_id] = lineId;
      return { line_id: lineId, item_id: itemId, doc_id: toDocId, label: l.label, amount_cents: l.amount_cents, kind: l.kind, addon_id: l.addon_id, sort: l.sort };
    });
    outItems.push({ item_id: itemId, doc_id: toDocId, product_id: it.product_id, package_id: it.package_id, title: it.title, qty: it.qty, sort: it.sort, details_json: it.details_json, _lines: mine });
    outLines = outLines.concat(mine);
  });
  outItems.forEach(function (it) {
    try {
      var d = JSON.parse(it.details_json || '{}');
      if (Array.isArray(d.spots)) {
        d.spots.forEach(function (sp) { if (sp.line_id && lineMap[sp.line_id]) sp.line_id = lineMap[sp.line_id]; });
        it.details_json = JSON.stringify(d);
      }
    } catch (err) { /* leave details as they were */ }
  });
  var totals = computeTotals_(outItems.map(function (it) { return { qty: it.qty, lines: it._lines }; }), discountCents);
  outItems.forEach(function (it) { delete it._lines; });
  return { items: outItems, lines: outLines, totals: totals };
}

/**
 * Turn a quote into a new invoice (call inside the lock). Copies items, lines, details, customer,
 * fulfillment, notes, discount and upfront percent, with a new TR- number and new ids.
 * opts.sentMethod: 'customer_approved' marks the invoice as already sent (the customer is looking at it).
 * Returns the new invoice row; the quote becomes "converted".
 */
function convertQuote_(quote, opts) {
  var now = nowIso_();
  var invoice = {
    doc_id: newId_('D'), public_id: newPublicId_(), type: 'invoice', number: nextNumber_('invoice'),
    customer_id: quote.customer_id, status: opts.sentMethod ? 'issued' : 'draft', stage: 'awaiting_payment',
    fulfillment: quote.fulfillment, created_at: now, updated_at: now,
    sent_at: opts.sentMethod ? now : '', sent_method: opts.sentMethod || '',
    view_count: 0, from_quote_id: quote.doc_id, est_ready_date: quote.est_ready_date,
    upfront_percent: quote.upfront_percent || 100, discount_cents: quote.discount_cents || 0,
    discount_label: quote.discount_label, paid_cents: 0,
    customer_note: quote.customer_note, internal_notes: quote.internal_notes
  };
  var copy = copyItems_(quote.doc_id, invoice.doc_id, invoice.discount_cents);
  invoice.subtotal_cents = copy.totals.subtotal_cents;
  invoice.total_cents = copy.totals.total_cents;
  appendRows_('Documents', [invoice]);
  appendRows_('DocItems', copy.items);
  appendRows_('DocLines', copy.lines);

  quote.status = 'converted';
  quote.converted_invoice_id = invoice.doc_id;
  quote.updated_at = now;
  updateRow_('Documents', quote);
  logEvent_('converted', quote.doc_id, 'Became invoice ' + invoice.number);
  logEvent_('created', invoice.doc_id, 'Invoice ' + invoice.number + ' from quote ' + quote.number);
  return invoice;
}

/* ---------- order actions (SPEC 5.4, 5.5, 6.5) ---------- */

var STAGES = ['awaiting_payment', 'in_progress', 'ready', 'completed', 'cancelled'];
var STAGE_WORDS = { awaiting_payment: 'Awaiting payment', in_progress: 'In progress', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled' };

/** Find a document for an action (inside the lock), refusing void ones. */
function docForAction_(id, what) {
  var doc = findBy_(readTable_('Documents'), 'doc_id', vId_(id, 'Order'));
  if (!doc) throw appError('NOT_FOUND', 'That order no longer exists.');
  if (doc.status === 'void') throw appError('VALIDATION', 'This order is void.');
  if (what === 'invoice' && doc.type !== 'invoice') throw appError('VALIDATION', 'This only works on invoices.');
  if (what === 'quote' && doc.type !== 'quote') throw appError('VALIDATION', 'This only works on quotes.');
  return doc;
}

/** Move an invoice to a stage, setting ready_at / completed_at. Drafts become issued. (inside the lock) */
function applyStage_(doc, stage, reason) {
  var now = nowIso_();
  if (doc.status === 'draft') doc.status = 'issued';
  doc.stage = stage;
  if (stage === 'ready') doc.ready_at = now;
  if (stage === 'completed') doc.completed_at = now;
  if (stage === 'cancelled') doc.void_reason = reason;
  doc.updated_at = now;
  updateRow_('Documents', doc);
  logEvent_('stage', doc.doc_id, STAGE_WORDS[stage] + (reason ? ': ' + reason : ''));
}

/** docs.setStage: { doc_id, stage, reason? } Manual moves forward or back. Cancelling needs a reason. */
function setStage_(p) {
  var stage = vEnum_(p.stage, STAGES, 'Stage');
  var reason = vStr_(p.reason, 'Reason', 500, stage === 'cancelled');
  return withLock_(function () {
    var doc = docForAction_(p.doc_id, 'invoice');
    applyStage_(doc, stage, reason);
    return getDocById_(doc.doc_id);
  });
}

/** checklist.toggle: { doc_id, item_id, step_no, done } Tick or untick one shop step. */
function toggleChecklist_(p) {
  var stepNo = Number(p.step_no);
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 20) throw appError('VALIDATION', 'That step is not valid.');
  var itemId = vId_(p.item_id, 'Item');
  return withLock_(function () {
    var doc = docForAction_(p.doc_id, 'invoice');
    if (!readTable_('DocItems').some(function (it) { return it.doc_id === doc.doc_id && it.item_id === itemId; })) {
      throw appError('NOT_FOUND', 'That item is no longer on this order.');
    }
    setStep_(doc.doc_id, itemId, stepNo, p.done !== false);
    return getDocById_(doc.doc_id);
  });
}

/** Save one checklist step as done (with today's time) or not done. (inside the lock) */
function setStep_(docId, itemId, stepNo, done, rows) {
  rows = rows || readTable_('Checklist');
  var row = rows.filter(function (r) { return r.doc_id === docId && r.item_id === itemId && r.step_no === stepNo; })[0];
  var value = done ? nowIso_() : '';
  if (row) {
    if (done && row.done_at) return; // keep the first date
    row.done_at = value;
    updateRow_('Checklist', row);
  } else if (done) {
    var item = findBy_(readTable_('DocItems'), 'item_id', itemId);
    var product = item ? findBy_(getCatalog_().products, 'product_id', item.product_id) : null;
    var labels = checklistSteps_(product ? product.detail_form : 'simple');
    var newRow = { doc_id: docId, item_id: itemId, step_no: stepNo, label: labels[stepNo - 1] || ('Step ' + stepNo), done_at: value };
    appendRows_('Checklist', [newRow]);
    rows.push(newRow);
  }
}

/** docs.void: { doc_id, reason } Numbers are never reused. A quote that became an invoice can't be voided. */
function voidDoc_(p) {
  var reason = vStr_(p.reason, 'Reason', 500, true);
  return withLock_(function () {
    var doc = docForAction_(p.doc_id);
    if (doc.status === 'converted') throw appError('VALIDATION', 'This quote became an invoice. Void the invoice instead.');
    doc.status = 'void';
    doc.void_reason = reason;
    doc.updated_at = nowIso_();
    updateRow_('Documents', doc);
    logEvent_('void', doc.doc_id, 'Void: ' + reason);
    return getDocById_(doc.doc_id);
  });
}

function quoteForConversion_(id) {
  var quote = docForAction_(id, 'quote');
  if (quote.status === 'converted') throw appError('VALIDATION', 'This quote is already an invoice.');
  if (!readTable_('DocItems').some(function (it) { return it.doc_id === quote.doc_id; })) {
    throw appError('VALIDATION', 'Add at least one item first.');
  }
  return quote;
}

/** docs.markApproved: { doc_id } For approvals by phone or in person: approves and makes the invoice (not sent yet). */
function markApproved_(p) {
  return withLock_(function () {
    var quote = quoteForConversion_(p.doc_id);
    quote.approved_at = nowIso_();
    quote.status = 'approved';
    updateRow_('Documents', quote);
    logEvent_('approved', quote.doc_id, 'Marked approved in the app');
    return getDocById_(convertQuote_(quote, {}).doc_id);
  });
}

/** docs.convertToInvoice: { doc_id } Makes an invoice from the quote (not sent yet). */
function convertToInvoice_(p) {
  return withLock_(function () {
    return getDocById_(convertQuote_(quoteForConversion_(p.doc_id), {}).doc_id);
  });
}

/** docs.renewQuote: { doc_id } An expired (or declined) quote gets a new expiry date and can be approved again. */
function renewQuote_(p) {
  return withLock_(function () {
    var quote = docForAction_(p.doc_id, 'quote');
    var status = effectiveStatus_(quote, Date.now());
    if (status !== 'expired' && status !== 'declined' && status !== 'sent') throw appError('VALIDATION', 'Only sent, expired or declined quotes can be renewed.');
    quote.status = 'sent';
    if (!quote.sent_at) quote.sent_at = nowIso_();
    quote.expires_at = addDaysIso_(Number(getSettings_().quote_expiry_days) || 30);
    quote.declined_at = '';
    quote.decline_note = '';
    quote.updated_at = nowIso_();
    updateRow_('Documents', quote);
    logEvent_('renewed', quote.doc_id, 'Renewed until ' + quote.expires_at.slice(0, 10));
    return getDocById_(quote.doc_id);
  });
}

/** docs.duplicate: { doc_id } A new draft of the same type, customer and items, with a new number. */
function duplicateDoc_(p) {
  return withLock_(function () {
    var src = findBy_(readTable_('Documents'), 'doc_id', vId_(p.doc_id, 'Order'));
    if (!src) throw appError('NOT_FOUND', 'That order no longer exists.');
    var now = nowIso_();
    var doc = {
      doc_id: newId_('D'), public_id: newPublicId_(), type: src.type, number: nextNumber_(src.type),
      customer_id: src.customer_id, status: 'draft', stage: src.type === 'invoice' ? 'awaiting_payment' : '',
      fulfillment: src.fulfillment, created_at: now, updated_at: now, view_count: 0,
      upfront_percent: src.upfront_percent || 100, discount_cents: src.discount_cents || 0, discount_label: src.discount_label,
      paid_cents: 0, customer_note: src.customer_note, internal_notes: src.internal_notes
    };
    var copy = copyItems_(src.doc_id, doc.doc_id, doc.discount_cents);
    doc.subtotal_cents = copy.totals.subtotal_cents;
    doc.total_cents = copy.totals.total_cents;
    appendRows_('Documents', [doc]);
    appendRows_('DocItems', copy.items);
    appendRows_('DocLines', copy.lines);
    logEvent_('created', doc.doc_id, 'Copy of ' + src.number);
    return getDocById_(doc.doc_id);
  });
}
