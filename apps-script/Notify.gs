/**
 * Notify.gs: emails to the business inbox with MailApp (SPEC 9). Free; well under the daily quota.
 *
 * ONE-TIME STEP after these files are added: in the Apps Script editor run setupNotifications
 * and allow the new permission (send email). Until then, emails are skipped quietly and
 * nothing else is affected (approvals still work).
 */

/** Run once from the editor: grants the email permission and schedules the daily digest (8 AM Phoenix). */
function setupNotifications() {
  var left = MailApp.getRemainingDailyQuota();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(8).everyDays(1).inTimezone(TZ).create();
  var msg = 'Email is ready (' + left + ' emails left today). The daily summary runs at about 8:00 AM when it is turned on in Settings.';
  try { SpreadsheetApp.getUi().alert('TR Orders notifications', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (err) { console.log(msg); }
  return msg;
}

/** Link to a screen of the admin app, if the app has told us its address (it does on every start). */
function appLink_(hash) {
  var base = PropertiesService.getScriptProperties().getProperty('APP_URL');
  return base ? base + 'index.html#' + hash : '';
}

/** Send a plain email to notify_email. Never throws: a failed email must not break the action. */
function notify_(subject, lines) {
  try {
    var to = getSettings_().notify_email;
    if (!to) return false;
    MailApp.sendEmail({ to: to, subject: subject, body: lines.filter(function (l) { return l !== null; }).join('\n'), name: 'TR Orders' });
    return true;
  } catch (err) {
    console.error('Email not sent: ' + err);
    return false;
  }
}

function money_(cents) {
  return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function notifyApproved_(quote, invoice, name) {
  var customer = findBy_(readTable_('Customers'), 'customer_id', quote.customer_id);
  var link = appLink_('/orders/' + invoice.number);
  return notify_('✅ ' + quote.number + ' approved by ' + name, [
    (customer ? customer.name : 'A customer') + ' approved quote ' + quote.number + ' (typed name: ' + name + ').',
    '',
    'Total: ' + money_(invoice.total_cents),
    'New invoice: ' + invoice.number + ' (already shown to the customer with payment details)',
    link ? '' : null,
    link ? 'Open it: ' + link : null
  ]);
}

function notifyDeclined_(quote, note) {
  var customer = findBy_(readTable_('Customers'), 'customer_id', quote.customer_id);
  var link = appLink_('/orders/' + quote.number);
  return notify_(quote.number + ' declined', [
    (customer ? customer.name : 'The customer') + ' declined quote ' + quote.number + ' (' + money_(quote.total_cents) + ').',
    '',
    note ? 'Their note: "' + note + '"' : 'They did not leave a note.',
    link ? '' : null,
    link ? 'Open it: ' + link : null
  ]);
}

/** Time-driven, 8 AM: overdue and ready-3+-days orders, only when turned on in Settings and there is something to say. */
function dailyDigest() {
  if (getSettings_().daily_digest !== 'on') return 'off';
  var d = dashboard_();
  var overdue = d.needs.overdue;
  var late = d.needs.ready_late;
  if (!overdue.length && !late.length) return 'nothing';
  var lines = [];
  if (overdue.length) {
    lines.push('Unpaid, overdue (' + overdue.length + '):');
    overdue.forEach(function (r) { lines.push('  ' + r.number + '  ' + r.customer_name + '  ' + money_(r.amount_due_cents) + ' due'); });
    lines.push('');
  }
  if (late.length) {
    lines.push('Ready 3+ days, not picked up or delivered (' + late.length + '):');
    late.forEach(function (r) { lines.push('  ' + r.number + '  ' + r.customer_name + (r.balance_overdue ? '  balance overdue' : '')); });
    lines.push('');
  }
  var home = appLink_('/home');
  if (home) lines.push('Open TR Orders: ' + home);
  notify_('TR Orders: ' + (overdue.length + late.length) + ' order' + (overdue.length + late.length === 1 ? '' : 's') + ' need attention', lines);
  return 'sent';
}
