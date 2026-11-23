/**
 * Setup.gs: run setup() once from the Apps Script editor.
 *
 * It is safe to run again: it only adds what is missing (tabs, columns,
 * settings, seed rows, folders) and re-creates the nightly backup trigger.
 * It never deletes or overwrites your data.
 */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Open the "TR Orders Data" Google Sheet, choose Extensions > Apps Script, and run setup from there.');
  }
  var ui = SpreadsheetApp.getUi();
  var report = [];

  ss.setSpreadsheetTimeZone(TZ);
  setupTabs_(ss, report);
  seedSettings_(report);
  seedCatalog_(report);
  setupFolders_(report);
  setupTriggers_(report);
  setupPasscode_(ui, report);
  clearCaches_();

  ui.alert('TR Orders setup finished', report.join('\n'), ui.ButtonSet.OK);
}

/* ---------- tabs ---------- */

function setupTabs_(ss, report) {
  var created = [];
  Object.keys(SCHEMA).forEach(function (name) {
    var cols = SCHEMA[name];
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      created.push(name);
    }
    var lastCol = sh.getLastColumn();
    var have = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    var missing = cols.filter(function (c) { return have.indexOf(c) === -1; });
    if (missing.length) {
      sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
      if (have.length) report.push('Added columns to ' + name + ': ' + missing.join(', '));
    }
    var all = have.concat(missing);
    var header = sh.getRange(1, 1, 1, all.length);
    header.setFontWeight('bold').setBackground('#201C19').setFontColor('#F9F6F0');
    sh.setFrozenRows(1);
    // Text columns are plain text so values like "01" and "623-521-6235" stay exactly as typed.
    if (sh.getMaxRows() < 2) sh.insertRowsAfter(1, 999);
    all.forEach(function (c, i) {
      sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat(formatFor_(c));
    });
    delete HEADER_CACHE_[name];
  });

  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  report.push(created.length ? 'Created tabs: ' + created.join(', ') : 'All tabs already exist.');
}

/* ---------- settings ---------- */

function seedSettings_(report) {
  var have = {};
  readTable_('Settings').forEach(function (r) { have[r.key] = true; });
  var add = SEED_SETTINGS.filter(function (kv) { return !have[kv[0]]; })
    .map(function (kv) { return { key: kv[0], value: kv[1] }; });
  appendRows_('Settings', add);
  report.push(add.length ? 'Added ' + add.length + ' settings.' : 'Settings already present.');
}

/* ---------- catalog ---------- */

function seedCatalog_(report) {
  if (readTable_('Products').length === 0) {
    var products = [], packages = [], lines = [], addOns = [];
    SEED_PRODUCTS.forEach(function (p, pi) {
      var productId = newId_('PRD');
      products.push({
        product_id: productId, name: p.name, detail_form: p.detail_form,
        active: true, sort: pi + 1, description: p.description || ''
      });
      p.packages.forEach(function (pk, ki) {
        var packageId = newId_('PKG');
        packages.push({
          package_id: packageId, product_id: productId, name: pk.name,
          price_note: pk.price_note || '', sort: ki + 1, active: true
        });
        pk.lines.forEach(function (ln, li) {
          lines.push({
            template_line_id: newId_('TL'), package_id: packageId, label: ln[0],
            amount_cents: ln[1], kind: ln[2], sort: li + 1
          });
        });
      });
      (p.addOns || []).forEach(function (a, ai) {
        addOns.push({
          addon_id: newId_('ADD'), product_id: productId, label: a[0], amount_cents: a[1],
          price_editable: a[2], rule: a[3], sort: ai + 1, active: true
        });
      });
    });
    appendRows_('Products', products);
    appendRows_('Packages', packages);
    appendRows_('TemplateLines', lines);
    appendRows_('AddOns', addOns);
    report.push('Added ' + products.length + ' products, ' + packages.length + ' packages, ' +
      lines.length + ' package lines, ' + addOns.length + ' add-ons.');
  } else {
    report.push('Products already present (not changed).');
  }

  if (readTable_('Patches').length === 0) {
    appendRows_('Patches', SEED_PATCHES.map(function (p) {
      return { patch_no: p[0], name: p[1], size: p[2], tier: p[3], group: p[4], active: true, photo_file_id: '' };
    }));
    report.push('Added ' + SEED_PATCHES.length + ' patches.');
  } else {
    report.push('Patches already present (not changed).');
  }
}

/* ---------- Drive folders ---------- */

function setupFolders_(report) {
  var props = PropertiesService.getScriptProperties();
  var root = existingFolder_(props.getProperty('ROOT_FOLDER_ID'));
  if (!root) {
    var found = DriveApp.getRootFolder().getFoldersByName('TR Orders');
    root = found.hasNext() ? found.next() : DriveApp.createFolder('TR Orders');
  }
  var photos = existingFolder_(props.getProperty('PHOTOS_FOLDER_ID')) || childFolder_(root, 'Order Photos');
  var backups = existingFolder_(props.getProperty('BACKUPS_FOLDER_ID')) || childFolder_(root, 'Backups');
  props.setProperties({
    ROOT_FOLDER_ID: root.getId(),
    PHOTOS_FOLDER_ID: photos.getId(),
    BACKUPS_FOLDER_ID: backups.getId()
  });
  report.push('Drive folders ready: TR Orders / Order Photos, TR Orders / Backups.');
}

function existingFolder_(id) {
  if (!id) return null;
  try {
    var f = DriveApp.getFolderById(id);
    return f.isTrashed() ? null : f;
  } catch (err) {
    return null;
  }
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* ---------- triggers ---------- */

function setupTriggers_(report) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightlyBackup').timeBased().atHour(2).everyDays(1).inTimezone(TZ).create();
  report.push('Nightly backup scheduled for about 2:00 AM (Phoenix time).');
}

/* ---------- passcode ---------- */

function setupPasscode_(ui, report) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('PASSCODE_HASH')) {
    var keep = ui.alert('Passcode', 'A passcode is already set. Do you want to change it?', ui.ButtonSet.YES_NO);
    if (keep !== ui.Button.YES) {
      report.push('Passcode unchanged.');
      return;
    }
  }
  for (var attempt = 0; attempt < 3; attempt++) {
    var first = ui.prompt('Choose a passcode',
      'Type a passcode of 6 or more digits (numbers only). Terri and Autumn will use it to open TR Orders.',
      ui.ButtonSet.OK_CANCEL);
    if (first.getSelectedButton() !== ui.Button.OK) break;
    var code = first.getResponseText().trim();
    if (!isValidPasscode_(code)) {
      ui.alert('Passcode', 'Please use 6 to 20 digits, numbers only.', ui.ButtonSet.OK);
      continue;
    }
    var again = ui.prompt('Confirm passcode', 'Type the same passcode again.', ui.ButtonSet.OK_CANCEL);
    if (again.getSelectedButton() !== ui.Button.OK) break;
    if (again.getResponseText().trim() !== code) {
      ui.alert('Passcode', 'Those did not match. Let\'s try again.', ui.ButtonSet.OK);
      continue;
    }
    setPasscode_(code);
    props.deleteProperty('LOGIN_FAILS');
    props.deleteProperty('LOGIN_LOCKED_UNTIL');
    report.push('Passcode saved.');
    return;
  }
  report.push(props.getProperty('PASSCODE_HASH')
    ? 'Passcode unchanged.'
    : 'NO PASSCODE SET. Run setup() again to choose one; nobody can sign in until you do.');
}

/* ---------- seed data (SPEC section 14) ---------- */

var SEED_TERMS = [
  { title: 'Payment', text: 'The full amount is due at the time of order.' },
  { title: 'When work begins', text: 'Work does not begin until payment is received.' },
  { title: 'Work and timeline', text: 'The work and the timeline are estimated. Completion dates are estimates, not guarantees, and run from the day payment is received. Delays in jacket, patch or shipping deliveries are outside our control.' },
  { title: 'Cancellation', text: 'You may cancel within 24 hours of payment, before your jacket and patches are purchased, for a full refund.' },
  { title: 'After that', text: 'Once your jacket and patches are purchased or work has begun, the order cannot be cancelled and the payment is non-refundable, because each jacket is made to your order.' },
  { title: 'Returns', text: 'Custom jackets cannot be returned or exchanged. The patches, placement and sizes you confirm on your order are final.' },
  { title: 'If something is wrong', text: 'Tell us within 7 days of pickup or delivery, with your order number and photos. If our sewing or lining work is at fault, we will repair or redo it at no charge.' },
  { title: 'Ownership', text: 'All prices and descriptions belong to Terri Renee Evolvé.' }
];

var SEED_SETTINGS = [
  ['business_name', 'Terri Renee Evolvé'],
  ['app_name', 'TR Orders'],
  ['phone', '623-521-6235'],
  ['email', 'terrireneedesigns@gmail.com'],
  ['website', 'TerriReneedesigns.com'],
  ['zelle_contact', '623-523-7472'],
  ['zelle_display_name', 'THERESA ODOM'],
  ['upfront_percent_default', '100'],
  ['unpaid_flag_days', '7'],
  ['ready_flag_days', '3'],
  ['quote_expiry_days', '30'],
  ['next_quote_no', '1001'],
  ['next_order_no', '1001'],
  ['notify_email', 'terrireneedesigns@gmail.com'],
  ['msg_quote', 'Hi {first_name}, here is your quote {number} from Terri Renee Evolvé. Review and approve here: {link}'],
  ['msg_invoice', 'Hi {first_name}, here is your invoice {number} from Terri Renee Evolvé for {total}. Payment details are on the page: {link}'],
  ['msg_receipt', 'Thank you, {first_name}! Your payment for {number} is received: {link}'],
  ['msg_ready', 'Hi {first_name}, your order {number} is ready! {fulfillment_text}'],
  ['daily_digest', 'off'],
  ['terms_title', 'True Value Statement'],
  ['terms_json', JSON.stringify(SEED_TERMS)]
];

// [label, amount_cents, kind]
var JACKET_STANDARD_LINES = [
  ['Bomber jacket (men\'s or women\'s)', 8500, 'base'],
  ['Large back patch', 1800, 'base'],
  ['Chest and sleeve patches (3 × $10)', 3000, 'base'],
  ['Setup: open the lining, close it so it looks untouched', 4000, 'base'],
  ['Sew on main back patch', 4500, 'base'],
  ['Sew on chest left, chest right and sleeve (3 × $20)', 6000, 'base'],
  ['Package savings', -300, 'savings']
];
var PREMIUM_UPGRADE_LINE = ['Premium package: upgraded patches (chenille, larger embroidered or custom-made)', 6000, 'upgrade'];
var COLLECTOR_UPGRADE_LINE = ['Collector\'s package: gift packaging, priority turnaround', 7000, 'upgrade'];

var SEED_PRODUCTS = [
  {
    name: 'Custom Bomber Jacket',
    detail_form: 'jacket',
    packages: [
      { name: 'Standard', price_note: '$275', lines: JACKET_STANDARD_LINES },
      { name: 'Premium', price_note: '$335', lines: JACKET_STANDARD_LINES.concat([PREMIUM_UPGRADE_LINE]) },
      { name: 'Collector\'s', price_note: '$405', lines: JACKET_STANDARD_LINES.concat([PREMIUM_UPGRADE_LINE, COLLECTOR_UPGRADE_LINE]) }
    ],
    // [label, amount_cents, price_editable, rule]
    addOns: [
      ['Extra small patch (patch, sewing)', 2800, false, 'extra_patch'],
      ['Extra small or medium patch (patch, sewing)', 3500, false, 'extra_patch'],
      ['Extra large or premium patch (patch, sewing)', 4500, false, 'extra_patch'],
      ['Your own patch (sewing only)', 2000, true, 'extra_patch'],
      ['Left sleeve surcharge (zip pocket side)', 1000, false, 'left_sleeve'],
      ['Rush turnaround', 3500, false, '']
    ]
  },
  { name: 'Custom Hat', detail_form: 'simple', packages: [{ name: 'Custom', price_note: '', lines: [] }] },
  { name: 'Custom Purse', detail_form: 'simple', packages: [{ name: 'Custom', price_note: '', lines: [] }] }
];

var G_SM = 'Small and medium';
var G_LG = 'Large and custom-ordered';
var G_BK = 'Back-size (9 in and up)';

// [patch_no, name, size, tier, group]
var SEED_PATCHES = [
  ['01', 'I Miss Obama', '2.5 × 4 in', 'standard', G_SM],
  ['02', 'Angela Davis quote', '3 × 4 in', 'standard', G_SM],
  ['03', 'OES star', '3.5 × 3.5 in', 'standard', G_SM],
  ['04', 'Maricopa Chapter No. 1 OES', 'about 4 in', 'standard', G_SM],
  ['05', 'Prince Hall Free & Accepted Masons', '', 'standard', G_SM],
  ['06', 'Locs in Progress', '3.5 × 2.5 in', 'standard', G_SM],
  ['07', 'It Is What It Is', '', 'standard', G_SM],
  ['08', 'Faith Over Fear', '', 'standard', G_SM],
  ['09', 'They Not Like Us', 'about 4 × 3.5 in', 'standard', G_SM],
  ['10', 'Black Girl Magic (script)', '', 'standard', G_SM],
  ['11', 'Black Yesterday, Today, Everyday', '', 'standard', G_SM],
  ['12', 'Black Girl Magic (pink)', '', 'standard', G_SM],
  ['13', 'Queen cap', '', 'standard', G_SM],
  ['14', 'Crowned queen', '', 'standard', G_SM],
  ['15', '1913 cap', '', 'standard', G_SM],
  ['16', 'Well-behaved women', '', 'standard', G_SM],
  ['17', 'Black Queen nutrition facts', '', 'standard', G_SM],
  ['18', 'Minding my Black owned business', '', 'standard', G_SM],
  ['19', 'Black Girls Been Magic', '', 'standard', G_SM],
  ['20', 'Black, no sugar, no cream', '', 'standard', G_SM],
  ['21', 'Afro glam', '', 'standard', G_SM],
  ['22', 'Lips and tongue', '', 'standard', G_SM],
  ['23', 'Blue sun hat', '', 'standard', G_SM],
  ['24', 'Bubblegum afro', '', 'standard', G_SM],
  ['25', 'Leopard headwrap', '', 'standard', G_SM],
  ['26', 'Red, black and green chevron', '', 'standard', G_SM],
  ['27', 'Red, black and green wings', '', 'standard', G_SM],
  ['28', 'Gye Nyame symbol', '', 'standard', G_SM],
  ['29', 'Initiated, Passed, Raised', '6 × 4 in', 'premium', G_LG],
  ['30', 'OES chenille letters', 'about 6 × 3 in', 'premium', G_LG],
  ['31', 'OES For Life', 'about 6.5 in wide', 'premium', G_LG],
  ['32', 'OES star banner', 'about 6 × 5.5 in', 'premium', G_LG],
  ['33', 'OES Sisterhood', 'about 7 in tall', 'premium', G_LG],
  ['34', 'Masonic square and compass with G', '5 × 5 in', 'premium', G_LG],
  ['35', 'OES, Order of the Eastern Star', '9 × 5 in', 'premium', G_BK],
  ['36', 'Relief, Brotherly Love, Truth', '10 × 10 in', 'premium', G_BK],
  ['37', 'Mason: Look to the East', '11 × 9.75 in', 'premium', G_BK],
  ['38', 'Grand Lodge officer', '3 × 3 in', 'standard', G_SM],
  ['39', 'Masonic past master', '3 × 3 in', 'standard', G_SM],
  ['40', 'Masonic past master (flat)', '3 × 3 in', 'standard', G_SM],
  ['41', 'OES star with square and compass', '3 × 3 in', 'standard', G_SM],
  ['42', 'Masonic square and compass with G', '3 × 3 in', 'standard', G_SM],
  ['43', 'Initiated, Passed, Raised (small)', '3.5 × 2.75 in', 'standard', G_SM],
  ['44', 'Black and white square and compass with G', '3¾ × 3⅞ in', 'standard', G_SM],
  ['45', 'OES lady', '4 in', 'premium', G_LG]
];
