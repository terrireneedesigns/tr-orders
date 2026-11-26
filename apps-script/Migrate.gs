/**
 * Migrate.gs: one-time data changes, run from the Apps Script editor. Each is safe to run again.
 */

/**
 * Nov 2026: drop the "Package savings" line (−$3.00) from the jacket packages and from unsent
 * drafts, keeping every total the same: the savings amount comes off the "Setup: open the
 * lining…" line instead ($40 → $37). Sent, approved or paid orders and quotes are not touched.
 */
function removePackageSavings() {
  var report = withLock_(function () { return removePackageSavings_(); });
  SpreadsheetApp.getUi().alert('Package savings removed',
    'Packages changed: ' + report.packages.length + (report.packages.length ? ' (' + report.packages.join(', ') + ')' : '') + '\n' +
    'Draft orders and quotes changed: ' + report.drafts.length + (report.drafts.length ? ' (' + report.drafts.join(', ') + ')' : '') +
    (report.skipped.length ? '\n\nNot changed (no "Setup" line to take the savings from): ' + report.skipped.join(', ') : '') +
    '\n\nTotals are the same as before.', SpreadsheetApp.getUi().ButtonSet.OK);
  return report;
}

/** The setup line a savings amount is folded into. */
function setupLineOf_(lines) {
  return lines.filter(function (l) { return /^setup\b/i.test(String(l.label)); })[0] || null;
}

/** Does the work (call inside the lock). Returns { packages, drafts, skipped } as names/numbers. */
function removePackageSavings_() {
  var report = { packages: [], drafts: [], skipped: [] };

  // 1. Package price lines (TemplateLines)
  var pkgs = readTable_('Packages');
  var tl = readTable_('TemplateLines');
  pkgs.forEach(function (pk) {
    var lines = tl.filter(function (l) { return l.package_id === pk.package_id; }).sort(bySort_);
    var savings = lines.filter(function (l) { return l.kind === 'savings'; });
    if (!savings.length) return;
    var setup = setupLineOf_(lines);
    if (!setup) { report.skipped.push(pk.name + ' package'); return; }
    savings.forEach(function (s) { setup.amount_cents += s.amount_cents; });
    replaceLines_(pk.package_id, lines.filter(function (l) { return l.kind !== 'savings'; }).map(function (l) {
      return { template_line_id: l.template_line_id, label: l.label, amount_cents: l.amount_cents, kind: l.kind };
    }));
    report.packages.push(pk.name);
  });

  // 2. Unsent, unpaid drafts (quotes and invoices)
  var drafts = readTable_('Documents').filter(function (d) { return d.status === 'draft' && !d.paid_cents && !d.sent_at; });
  if (drafts.length) {
    var allLines = readTable_('DocLines');
    var removeIds = [];
    drafts.forEach(function (d) {
      var mine = allLines.filter(function (l) { return l.doc_id === d.doc_id; });
      var changed = false;
      var itemIds = mine.map(function (l) { return l.item_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      itemIds.forEach(function (itemId) {
        var lines = mine.filter(function (l) { return l.item_id === itemId; });
        var savings = lines.filter(function (l) { return l.kind === 'savings'; });
        if (!savings.length) return;
        var setup = setupLineOf_(lines);
        if (!setup) { report.skipped.push(d.number); return; }
        savings.forEach(function (s) { setup.amount_cents += s.amount_cents; removeIds.push(s.line_id); });
        updateRow_('DocLines', setup);
        changed = true;
      });
      if (changed) report.drafts.push(d.number);
    });
    // Delete after the updates (deleting shifts row numbers).
    removeIds.forEach(function (id) { deleteRowsWhere_('DocLines', 'line_id', id); });
  }

  clearCaches_();
  if (report.packages.length || report.drafts.length) {
    logEvent_('migration', '', 'Package savings removed: packages ' + report.packages.join(', ') + '; drafts ' + report.drafts.join(', '));
  }
  return report;
}
