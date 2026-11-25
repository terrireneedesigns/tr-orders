/**
 * Costs.gs: profit tracking (replaces Terri's "Sewing Profit Tracker" spreadsheet).
 *
 * - Costs: money spent. Either on one order (doc_id) or general (doc_id blank: bulk patches,
 *   thread, tools). qty x each_cents = amount_cents, like the spreadsheet's Patches tab.
 * - TimeLog: hours worked on an order, typed by hand (minutes).
 * - PackageCosts: typical costs per package. New invoices get them added automatically
 *   ("auto" rows); editing an auto row makes it a normal row.
 *
 * Incoming money comes from the orders themselves, so nothing is typed twice.
 * None of this is ever shown on the customer page.
 */

var COST_CATEGORIES = ['jacket', 'fabric', 'patches', 'supplies', 'shipping', 'other'];
var DEFAULT_WORK_TASKS = ['Design', 'Cutting', 'Sewing', 'Airbrushing', 'Patches / embroidery', 'Fitting',
  'Finishing / pressing', 'Photos / listing', 'Shipping / packing', 'Other'];
var DEFAULT_HOURLY_RATE_CENTS = 2000;
var MAX_PACKAGE_COSTS = 20;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function vDate_(v, label) {
  var d = vStr_(v, label, 10) || todayStr_();
  if (!DATE_RE.test(d)) throw appError('VALIDATION', 'The ' + label.toLowerCase() + ' isn\'t a valid date.');
  return d;
}

function hourlyRateCents_() {
  var r = Number(getSettings_().hourly_rate_cents);
  return r >= 0 ? r : DEFAULT_HOURLY_RATE_CENTS;
}

/** An invoice that costs and time can be added to (cancelled is fine: money may already be spent). */
function trackableDoc_(id) {
  return docForAction_(id, 'invoice');
}

/* ---------- per-order summary ---------- */

/** Money in for profit: what was charged, or for a cancelled order only what was kept. */
function incomeCents_(doc) {
  return doc.stage === 'cancelled' ? (doc.paid_cents || 0) : (doc.total_cents || 0);
}

/** Costs, time and profit for one invoice (admin only). */
function trackingFor_(doc, costRows, timeRows) {
  var costs = (costRows || readTable_('Costs')).filter(function (c) { return c.doc_id === doc.doc_id && !c.voided; })
    .map(clean_).sort(function (a, b) { return a.spent_on < b.spent_on ? -1 : a.spent_on > b.spent_on ? 1 : 0; });
  var time = (timeRows || readTable_('TimeLog')).filter(function (t) { return t.doc_id === doc.doc_id && !t.voided; })
    .map(clean_).sort(function (a, b) { return a.worked_on < b.worked_on ? -1 : a.worked_on > b.worked_on ? 1 : 0; });
  var spent = costs.reduce(function (s, c) { return s + (c.amount_cents || 0); }, 0);
  var minutes = time.reduce(function (s, t) { return s + (t.minutes || 0); }, 0);
  var rate = hourlyRateCents_();
  var labor = Math.round(minutes * rate / 60);
  var income = incomeCents_(doc);
  return {
    costs: costs, time: time, spent_cents: spent, minutes: minutes, hourly_rate_cents: rate,
    labor_cents: labor, income_cents: income, profit_cents: income - spent, profit_after_labor_cents: income - spent - labor
  };
}

/* ---------- costs ---------- */

/**
 * costs.save: { cost_id?, doc_id? (blank = general), category, description, supplier, qty, each_cents, spent_on }
 * Returns { cost, tracking } (tracking is null for a general cost).
 */
function saveCost_(p) {
  var category = vEnum_(p.category, COST_CATEGORIES, 'Category');
  var description = vStr_(p.description, 'What it was', 200);
  var supplier = vStr_(p.supplier, 'Where from', 100);
  var qty = p.qty === undefined || p.qty === '' ? 1 : Number(p.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw appError('VALIDATION', 'How many must be a whole number from 1 to 999.');
  var each = vCents_(p.each_cents, 'Cost');
  if (each < 0) throw appError('VALIDATION', 'The cost can\'t be negative.');
  if (each * qty > MAX_CENTS) throw appError('VALIDATION', 'The total must be up to $100,000.');
  var spentOn = vDate_(p.spent_on, 'Date');
  return withLock_(function () {
    var now = nowIso_();
    var row;
    if (p.cost_id) {
      row = findBy_(readTable_('Costs'), 'cost_id', vId_(p.cost_id, 'Cost'));
      if (!row || row.voided) throw appError('NOT_FOUND', 'That cost no longer exists. Pull down to refresh.');
      if (row.doc_id) trackableDoc_(row.doc_id);
      row.category = category; row.description = description; row.supplier = supplier;
      row.qty = qty; row.each_cents = each; row.amount_cents = qty * each; row.spent_on = spentOn;
      row.auto = false; row.updated_at = now;
      updateRow_('Costs', row);
    } else {
      var docId = p.doc_id ? trackableDoc_(p.doc_id).doc_id : '';
      row = {
        cost_id: newId_('CO'), doc_id: docId, item_id: '', category: category, description: description,
        supplier: supplier, qty: qty, each_cents: each, amount_cents: qty * each, spent_on: spentOn,
        auto: false, created_at: now, updated_at: now, voided: false
      };
      appendRows_('Costs', [row]);
    }
    return { cost: clean_(row), tracking: row.doc_id ? trackingFor_(findBy_(readTable_('Documents'), 'doc_id', row.doc_id)) : null };
  });
}

/** costs.delete: { cost_id } Marks the cost void (kept in the Sheet for the record). */
function deleteCost_(p) {
  var id = vId_(p.cost_id, 'Cost');
  return withLock_(function () {
    var row = findBy_(readTable_('Costs'), 'cost_id', id);
    if (!row || row.voided) throw appError('NOT_FOUND', 'That cost no longer exists. Pull down to refresh.');
    if (row.doc_id) trackableDoc_(row.doc_id);
    row.voided = true;
    row.updated_at = nowIso_();
    updateRow_('Costs', row);
    return { tracking: row.doc_id ? trackingFor_(findBy_(readTable_('Documents'), 'doc_id', row.doc_id)) : null };
  });
}

/* ---------- time ---------- */

/** time.save: { time_id?, doc_id, worked_on, task, minutes, note } Returns { tracking }. */
function saveTime_(p) {
  var task = vStr_(p.task, 'Task', 60, true);
  var minutes = Number(p.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw appError('VALIDATION', 'Time worked must be from 1 minute to 24 hours.');
  }
  var workedOn = vDate_(p.worked_on, 'Date');
  var note = vStr_(p.note, 'Note', 500);
  return withLock_(function () {
    var row;
    if (p.time_id) {
      row = findBy_(readTable_('TimeLog'), 'time_id', vId_(p.time_id, 'Time entry'));
      if (!row || row.voided) throw appError('NOT_FOUND', 'That time entry no longer exists. Pull down to refresh.');
      trackableDoc_(row.doc_id);
      row.task = task; row.minutes = minutes; row.worked_on = workedOn; row.note = note;
      updateRow_('TimeLog', row);
    } else {
      var doc = trackableDoc_(p.doc_id);
      row = {
        time_id: newId_('TM'), doc_id: doc.doc_id, worked_on: workedOn, task: task, minutes: minutes,
        note: note, created_at: nowIso_(), voided: false
      };
      appendRows_('TimeLog', [row]);
    }
    return { tracking: trackingFor_(findBy_(readTable_('Documents'), 'doc_id', row.doc_id)) };
  });
}

/** time.delete: { time_id } */
function deleteTime_(p) {
  var id = vId_(p.time_id, 'Time entry');
  return withLock_(function () {
    var row = findBy_(readTable_('TimeLog'), 'time_id', id);
    if (!row || row.voided) throw appError('NOT_FOUND', 'That time entry no longer exists. Pull down to refresh.');
    trackableDoc_(row.doc_id);
    row.voided = true;
    updateRow_('TimeLog', row);
    return { tracking: trackingFor_(findBy_(readTable_('Documents'), 'doc_id', row.doc_id)) };
  });
}

/* ---------- typical costs per package ---------- */

/** catalog.savePackageCosts: { package_id, costs: [{ category, description, amount_cents }] } -> { id, catalog } */
function savePackageCosts_(p) {
  var packageId = vId_(p.package_id, 'Package');
  if (!Array.isArray(p.costs)) throw appError('VALIDATION', 'The typical costs are missing.');
  if (p.costs.length > MAX_PACKAGE_COSTS) throw appError('VALIDATION', 'A package can have up to ' + MAX_PACKAGE_COSTS + ' typical costs.');
  var costs = p.costs.map(function (c, i) {
    var n = i + 1;
    var amount = vCents_(c && c.amount_cents, 'Typical cost ' + n);
    if (amount < 0) throw appError('VALIDATION', 'Typical cost ' + n + ' can\'t be negative.');
    return {
      category: vEnum_(c.category, COST_CATEGORIES, 'Typical cost ' + n + ' category'),
      description: vStr_(c.description, 'Typical cost ' + n + ' description', 200),
      amount_cents: amount
    };
  });
  return withLock_(function () {
    mustFind_(readTable_('Packages'), 'package_id', packageId, 'package');
    var keep = readTable_('PackageCosts').filter(function (r) { return r.package_id !== packageId; });
    var fresh = costs.map(function (c, i) {
      return { package_cost_id: newId_('PC'), package_id: packageId, category: c.category, description: c.description, amount_cents: c.amount_cents, sort: i + 1 };
    });
    rewriteTable_('PackageCosts', keep.concat(fresh));
    return { id: packageId, catalog: freshCatalog_() };
  });
}

/**
 * Keep an invoice's automatic costs in step with its items (call inside the lock, after saving items).
 * - Each item with a package that has typical costs, and no cost rows yet, gets them (x qty).
 * - Unedited auto costs follow the item's quantity, and go away (void) if the item is removed.
 * An item whose auto costs were all deleted keeps none (the void rows remember it).
 */
function syncAutoCosts_(docId) {
  var items = readTable_('DocItems').filter(function (it) { return it.doc_id === docId; });
  var byItem = {};
  items.forEach(function (it) { byItem[it.item_id] = it; });
  var costs = readTable_('Costs').filter(function (c) { return c.doc_id === docId; });
  var now = nowIso_();
  var changed = [];
  costs.forEach(function (c) {
    if (!c.item_id || !c.auto || c.voided) return;
    var it = byItem[c.item_id];
    if (!it) {
      c.voided = true; c.updated_at = now; changed.push(c);
    } else if (c.qty !== it.qty) {
      c.qty = it.qty; c.amount_cents = it.qty * c.each_cents; c.updated_at = now; changed.push(c);
    }
  });
  updateRows_('Costs', changed);

  var hasCosts = {};
  costs.forEach(function (c) { if (c.item_id) hasCosts[c.item_id] = true; });
  var typical = getCatalog_().packageCosts || [];
  var add = [];
  items.forEach(function (it) {
    if (!it.package_id || hasCosts[it.item_id]) return;
    typical.filter(function (pc) { return pc.package_id === it.package_id; }).sort(bySort_).forEach(function (pc) {
      add.push({
        cost_id: newId_('CO'), doc_id: docId, item_id: it.item_id, category: pc.category, description: pc.description,
        supplier: '', qty: it.qty, each_cents: pc.amount_cents, amount_cents: pc.amount_cents * it.qty,
        spent_on: todayStr_(), auto: true, created_at: now, updated_at: now, voided: false
      });
    });
  });
  appendRows_('Costs', add);
}

/** When an invoice is voided, its automatic (never edited) costs go too. Costs she typed stay. */
function voidAutoCosts_(docId) {
  var now = nowIso_();
  var rows = readTable_('Costs').filter(function (c) { return c.doc_id === docId && c.auto && !c.voided; });
  rows.forEach(function (c) { c.voided = true; c.updated_at = now; });
  updateRows_('Costs', rows);
}

/* ---------- profit summary ---------- */

/**
 * profit.get: { from?, to? } (YYYY-MM-DD, both included; blank = no limit) -> the Profit screen.
 * Orders count by the date they were made; general costs by the date they were bought.
 * Orders are sent or paid invoices (not drafts, not void). Cancelled orders count only what was kept.
 */
function getProfit_(p) {
  var from = vStr_(p.from, 'From', 10);
  var to = vStr_(p.to, 'To', 10);
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw appError('VALIDATION', 'Those dates aren\'t valid.');
  var inRange = function (d) { return !!d && (!from || d >= from) && (!to || d <= to); };

  var costRows = readTable_('Costs').filter(function (c) { return !c.voided; });
  var timeRows = readTable_('TimeLog').filter(function (t) { return !t.voided; });
  var customers = {};
  readTable_('Customers').forEach(function (c) { customers[c.customer_id] = c.name; });
  var productNames = {};
  getCatalog_().products.forEach(function (pr) { productNames[pr.product_id] = pr.name; });
  var itemsByDoc = {};
  readTable_('DocItems').forEach(function (it) { (itemsByDoc[it.doc_id] = itemsByDoc[it.doc_id] || []).push(it); });

  var byCategory = {};
  COST_CATEGORIES.forEach(function (k) { byCategory[k] = 0; });
  var byProduct = {};
  var t = { income_cents: 0, received_cents: 0, owed_cents: 0, order_costs_cents: 0, general_costs_cents: 0, minutes: 0, labor_cents: 0 };
  var rate = hourlyRateCents_();

  var orders = readTable_('Documents').filter(function (d) {
    return d.type === 'invoice' && d.status !== 'void' && d.status !== 'draft' && inRange(String(d.created_at).slice(0, 10));
  }).map(function (d) {
    var tr = trackingFor_(d, costRows, timeRows);
    var names = (itemsByDoc[d.doc_id] || []).map(function (it) { return productNames[it.product_id] || 'Other'; })
      .filter(function (n, i, all) { return all.indexOf(n) === i; });
    var product = names.length === 1 ? names[0] : names.length ? 'Several products' : 'Other';
    var owed = d.stage === 'cancelled' ? 0 : Math.max(0, (d.total_cents || 0) - (d.paid_cents || 0));
    t.income_cents += tr.income_cents;
    t.received_cents += d.paid_cents || 0;
    t.owed_cents += owed;
    t.order_costs_cents += tr.spent_cents;
    t.minutes += tr.minutes;
    t.labor_cents += tr.labor_cents;
    tr.costs.forEach(function (c) { byCategory[c.category] = (byCategory[c.category] || 0) + c.amount_cents; });
    var bp = byProduct[product] = byProduct[product] || { product: product, orders: 0, income_cents: 0, spent_cents: 0, minutes: 0, profit_cents: 0, profit_after_labor_cents: 0 };
    bp.orders++; bp.income_cents += tr.income_cents; bp.spent_cents += tr.spent_cents; bp.minutes += tr.minutes;
    bp.profit_cents += tr.profit_cents; bp.profit_after_labor_cents += tr.profit_after_labor_cents;
    return {
      doc_id: d.doc_id, number: d.number, customer_name: customers[d.customer_id] || '', created_at: d.created_at,
      stage: d.stage, product: product, income_cents: tr.income_cents, paid_cents: d.paid_cents || 0,
      spent_cents: tr.spent_cents, cost_count: tr.costs.length, minutes: tr.minutes, labor_cents: tr.labor_cents,
      profit_cents: tr.profit_cents, profit_after_labor_cents: tr.profit_after_labor_cents
    };
  }).sort(function (a, b) { return isoMs_(b.created_at) - isoMs_(a.created_at); });

  var general = costRows.filter(function (c) { return !c.doc_id && inRange(c.spent_on); }).map(clean_)
    .sort(function (a, b) { return a.spent_on < b.spent_on ? 1 : a.spent_on > b.spent_on ? -1 : 0; });
  general.forEach(function (c) {
    t.general_costs_cents += c.amount_cents;
    byCategory[c.category] = (byCategory[c.category] || 0) + c.amount_cents;
  });

  t.spent_cents = t.order_costs_cents + t.general_costs_cents;
  t.profit_cents = t.income_cents - t.spent_cents;
  t.profit_after_labor_cents = t.profit_cents - t.labor_cents;
  t.per_hour_cents = t.minutes ? Math.round(t.profit_cents * 60 / t.minutes) : null;
  t.hourly_rate_cents = rate;
  t.orders = orders.length;
  t.orders_without_costs = orders.filter(function (o) { return !o.cost_count; }).length;

  return {
    from: from, to: to, totals: t,
    by_category: COST_CATEGORIES.map(function (k) { return { category: k, cents: byCategory[k] || 0 }; }),
    by_product: Object.keys(byProduct).map(function (k) { return byProduct[k]; })
      .sort(function (a, b) { return b.income_cents - a.income_cents; }),
    orders: orders,
    general_costs: general
  };
}
