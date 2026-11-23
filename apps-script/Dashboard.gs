/**
 * Dashboard.gs: dashboard.get for the Home screen (SPEC 6.2). Also used by the daily digest email.
 */

/**
 * Needs-attention lists and snapshot numbers, all derived on read.
 * Lists: not_sent, overdue, ready_late, quotes_expiring, quotes_waiting (waiting excludes expiring).
 */
function dashboard_() {
  var now = Date.now();
  var settings = getSettings_();
  var customers = {};
  readTable_('Customers').forEach(function (c) { customers[c.customer_id] = c.name; });
  var itemCounts = {};
  readTable_('DocItems').forEach(function (it) { itemCounts[it.doc_id] = (itemCounts[it.doc_id] || 0) + 1; });

  var needs = { not_sent: [], overdue: [], ready_late: [], quotes_expiring: [], quotes_waiting: [] };
  var snapshot = { unpaid_total_cents: 0, collected_month_cents: 0, in_progress: 0, ready: 0 };

  readTable_('Documents').forEach(function (d) {
    if (d.status === 'void') return;
    var flags = docFlags_(d, itemCounts[d.doc_id] || 0, settings, now);
    var row = {
      number: d.number, type: d.type, customer_name: customers[d.customer_id] || '',
      total_cents: d.total_cents, amount_due_cents: amountDueNow_(d),
      sent_at: d.sent_at, ready_at: d.ready_at, expires_at: d.expires_at, created_at: d.created_at,
      balance_overdue: flags.balance_overdue
    };
    if (flags.not_sent) needs.not_sent.push(row);
    if (flags.overdue) needs.overdue.push(row);
    if (flags.ready_late) needs.ready_late.push(row);
    if (flags.quote_expiring) needs.quotes_expiring.push(row);
    else if (flags.quote_waiting) needs.quotes_waiting.push(row);

    if (d.type === 'invoice' && d.status === 'issued' && d.stage !== 'cancelled') {
      snapshot.unpaid_total_cents += amountDueNow_(d);
      if (d.stage === 'in_progress') snapshot.in_progress++;
      if (d.stage === 'ready') snapshot.ready++;
    }
  });

  var month = todayStr_().slice(0, 7);
  var live = {};
  readTable_('Documents').forEach(function (d) { if (d.status !== 'void') live[d.doc_id] = true; });
  readTable_('Payments').forEach(function (pmt) {
    if (!pmt.voided && live[pmt.doc_id] && String(pmt.paid_on).slice(0, 7) === month) snapshot.collected_month_cents += pmt.amount_cents;
  });

  var byDate = function (key, dir) {
    return function (a, b) { return dir * (isoMs_(a[key] || a.created_at) - isoMs_(b[key] || b.created_at)); };
  };
  needs.not_sent.sort(byDate('created_at', -1));
  needs.overdue.sort(byDate('sent_at', 1));
  needs.ready_late.sort(byDate('ready_at', 1));
  needs.quotes_expiring.sort(byDate('expires_at', 1));
  needs.quotes_waiting.sort(byDate('sent_at', -1));
  return { needs: needs, snapshot: snapshot, month: month };
}

function getDashboard_() {
  return dashboard_();
}
