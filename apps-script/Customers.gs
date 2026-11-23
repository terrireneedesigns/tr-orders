/**
 * Customers.gs: customers.save, customers.get, customers.list, plus derived stats.
 * Customers are never deleted; they can be archived (hidden from lists).
 */

/** Digits only, without a leading US "1", for matching phone numbers. */
function phoneDigits_(s) {
  var d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
  return d;
}

/** "6235216235" or "(623) 521-6235" -> "623-521-6235". Other formats are kept as typed. */
function cleanPhone_(v) {
  var t = vStr_(v, 'Phone', 30);
  var d = phoneDigits_(t);
  return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : t;
}

function cleanEmail_(v) {
  var e = vStr_(v, 'Email', 100).toLowerCase();
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    throw appError('VALIDATION', 'That email address doesn\'t look right.');
  }
  return e;
}

/** Customers who share a phone number or email with the one being added. */
function findDuplicates_(rows, phone, email, exceptId) {
  var d = phoneDigits_(phone);
  return rows.filter(function (c) {
    if (c.customer_id === exceptId) return false;
    if (d.length >= 7 && phoneDigits_(c.phone) === d) return true;
    return !!email && String(c.email).toLowerCase() === email;
  });
}

/**
 * customers.save: { customer_id?, name, phone, email, notes, archived?, force? }
 * When adding, if the phone or email matches someone already saved and `force` is not
 * set, nothing is saved and { saved: false, duplicates } comes back so the app can ask
 * "Use existing customer?".
 */
function saveCustomer_(p) {
  var name = vStr_(p.name, 'Name', 100, true);
  var phone = cleanPhone_(p.phone);
  var email = cleanEmail_(p.email);
  var notes = vStr_(p.notes, 'Notes', 5000);
  return withLock_(function () {
    var rows = readTable_('Customers');
    var now = nowIso_();
    var row;
    if (p.customer_id) {
      row = findBy_(rows, 'customer_id', vId_(p.customer_id, 'Customer'));
      if (!row) throw appError('NOT_FOUND', 'That customer no longer exists. Pull down to refresh.');
      row.name = name; row.phone = phone; row.email = email; row.notes = notes;
      if (p.archived !== undefined) row.archived = vBool_(p.archived);
      row.updated_at = now;
      updateRow_('Customers', row);
    } else {
      if (!p.force) {
        var dups = findDuplicates_(rows, phone, email);
        if (dups.length) {
          var stats = customerStatsMap_();
          return { saved: false, duplicates: dups.map(function (c) { return withStats_(c, stats); }) };
        }
      }
      row = {
        customer_id: newId_('C'), name: name, phone: phone, email: email, notes: notes,
        created_at: now, updated_at: now, archived: false
      };
      appendRows_('Customers', [row]);
    }
    return { saved: true, customer: withStats_(row, customerStatsMap_()) };
  });
}

/** customers.list: every customer (archived ones too, flagged) with stats, sorted by name. */
function listCustomers_() {
  var stats = customerStatsMap_();
  return readTable_('Customers')
    .map(function (c) { return withStats_(c, stats); })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

/** customers.get: { customer_id } -> { customer (with stats), orders } (orders newest first). */
function getCustomer_(p) {
  var id = vId_(p.customer_id, 'Customer');
  var c = findBy_(readTable_('Customers'), 'customer_id', id);
  if (!c) throw appError('NOT_FOUND', 'That customer no longer exists.');
  var docs = readTable_('Documents').filter(function (d) { return d.customer_id === id; });
  var stats = customerStatsMap_(docs);
  var orders = docs
    .sort(function (a, b) { return isoMs_(b.created_at) - isoMs_(a.created_at); })
    .map(function (d) {
      return {
        doc_id: d.doc_id, number: d.number, type: d.type, status: d.status, stage: d.stage,
        total_cents: d.total_cents, paid_cents: d.paid_cents, created_at: d.created_at
      };
    });
  return { customer: withStats_(c, stats), orders: orders };
}

function withStats_(c, statsMap) {
  var out = clean_(c);
  out.stats = statsMap[c.customer_id] || emptyStats_();
  return out;
}

function emptyStats_() {
  return { orders: 0, paid_orders: 0, total_spent_cents: 0, last_order_at: '', repeat: false, has_unpaid: false };
}

/**
 * Derived customer stats (SPEC 4.2, 5.9). Only issued invoices count as orders;
 * quotes, drafts, voided and cancelled orders do not.
 * Repeat customer = 2 or more paid invoices.
 */
function customerStatsMap_(docs) {
  var map = {};
  (docs || readTable_('Documents')).forEach(function (d) {
    if (d.type !== 'invoice' || d.status !== 'issued' || d.stage === 'cancelled') return;
    var s = map[d.customer_id] || (map[d.customer_id] = emptyStats_());
    s.orders++;
    s.total_spent_cents += d.paid_cents || 0;
    if ((d.paid_cents || 0) >= (d.total_cents || 0)) s.paid_orders++;
    else s.has_unpaid = true;
    if (isoMs_(d.created_at) > isoMs_(s.last_order_at)) s.last_order_at = d.created_at;
  });
  Object.keys(map).forEach(function (k) { map[k].repeat = map[k].paid_orders >= 2; });
  return map;
}
