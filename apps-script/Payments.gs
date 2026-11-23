/**
 * Payments.gs: record and void payments (SPEC 5.2, 5.5, 6.6). The app never collects money;
 * this records Zelle or cash payments Terri received.
 */

var PAYMENT_METHODS = ['zelle', 'cash'];

/**
 * payments.add: { doc_id, amount_cents, method, paid_on (YYYY-MM-DD), note }
 * Updates paid_cents. When the payment reaches the upfront amount on an order still awaiting
 * payment, the order moves to In progress and step 1 is ticked on every item.
 * Overpaying is allowed (the app warns first).
 */
function addPayment_(p) {
  var amount = vCents_(p.amount_cents, 'Amount');
  if (amount <= 0) throw appError('VALIDATION', 'The amount must be more than $0.');
  var method = vEnum_(p.method, PAYMENT_METHODS, 'Payment method');
  var paidOn = vStr_(p.paid_on, 'Date', 10) || todayStr_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw appError('VALIDATION', 'The date isn\'t a valid date.');
  var note = vStr_(p.note, 'Note', 500);
  return withLock_(function () {
    var doc = docForAction_(p.doc_id, 'invoice');
    if (doc.stage === 'cancelled') throw appError('VALIDATION', 'This order is cancelled.');
    appendRows_('Payments', [{
      payment_id: newId_('P'), doc_id: doc.doc_id, amount_cents: amount, method: method,
      paid_on: paidOn, note: note, created_at: nowIso_(), voided: false
    }]);
    logEvent_('payment', doc.doc_id, (method === 'zelle' ? 'Zelle' : 'Cash') + ' payment of $' + (amount / 100).toFixed(2));
    doc.paid_cents = paidCents_(doc.doc_id);
    if (doc.status === 'draft') doc.status = 'issued';
    doc.updated_at = nowIso_();
    var reachedUpfront = doc.paid_cents >= upfrontCents_(doc.total_cents, doc.upfront_percent);
    if (reachedUpfront && doc.stage === 'awaiting_payment') {
      applyStage_(doc, 'in_progress');
      var rows = readTable_('Checklist');
      readTable_('DocItems').filter(function (it) { return it.doc_id === doc.doc_id; })
        .forEach(function (it) { setStep_(doc.doc_id, it.item_id, 1, true, rows); });
    } else {
      updateRow_('Documents', doc);
    }
    return getDocById_(doc.doc_id);
  });
}

/** payments.void: { payment_id, reason? } Marks a payment as void (kept for the record) and updates paid_cents. */
function voidPayment_(p) {
  var id = vId_(p.payment_id, 'Payment');
  var reason = vStr_(p.reason, 'Reason', 500);
  return withLock_(function () {
    var pmt = findBy_(readTable_('Payments'), 'payment_id', id);
    if (!pmt) throw appError('NOT_FOUND', 'That payment no longer exists.');
    if (pmt.voided) throw appError('VALIDATION', 'That payment is already void.');
    var doc = docForAction_(pmt.doc_id, 'invoice');
    pmt.voided = true;
    if (reason) pmt.note = (pmt.note ? pmt.note + ' · ' : '') + 'Void: ' + reason;
    updateRow_('Payments', pmt);
    doc.paid_cents = paidCents_(doc.doc_id);
    doc.updated_at = nowIso_();
    updateRow_('Documents', doc);
    logEvent_('payment_void', doc.doc_id, 'Payment of $' + (pmt.amount_cents / 100).toFixed(2) + ' voided' + (reason ? ': ' + reason : ''));
    return getDocById_(doc.doc_id);
  });
}
