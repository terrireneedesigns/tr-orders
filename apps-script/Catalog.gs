/**
 * Catalog.gs: products, packages, template lines, add-ons, patches.
 * Read in bulk and cached; the cache is cleared whenever the catalog or settings change.
 */

function getCatalog_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_CATALOG);
  if (hit) return JSON.parse(hit);

  var cat = {
    products: readTable_('Products').map(clean_).sort(bySort_),
    packages: readTable_('Packages').map(clean_).sort(bySort_),
    templateLines: readTable_('TemplateLines').map(clean_).sort(bySort_),
    addOns: readTable_('AddOns').map(clean_).sort(bySort_),
    patches: readTable_('Patches').map(clean_).sort(function (a, b) {
      return String(a.patch_no).localeCompare(String(b.patch_no), 'en', { numeric: true });
    })
  };
  try {
    cache.put(CACHE_CATALOG, JSON.stringify(cat), 21600);
  } catch (err) {
    // Over the 100 KB cache limit: just skip caching.
  }
  return cat;
}

/* ---------- editing (Catalog tab) ----------
 * Each save returns { id, catalog } with the fresh catalog, so the app can update in one trip.
 * Changes only affect new orders: orders keep the lines that were copied into them.
 */

var DETAIL_FORMS = ['jacket', 'simple'];
var LINE_KINDS = ['base', 'savings', 'upgrade'];
var ADDON_RULES = ['', 'left_sleeve', 'extra_patch'];
var PATCH_TIERS = ['standard', 'premium'];
var PATCH_GROUPS = ['Small and medium', 'Large and custom-ordered', 'Back-size (9 in and up)'];
var MAX_TEMPLATE_LINES = 50;

function freshCatalog_() {
  clearCaches_();
  return getCatalog_();
}

function mustFind_(rows, col, id, what) {
  var row = findBy_(rows, col, id);
  if (!row) throw appError('NOT_FOUND', 'That ' + what + ' no longer exists. Pull down to refresh.');
  return row;
}

/** catalog.saveProduct: { product_id?, name, detail_form, description, active } */
function saveProduct_(p) {
  var name = vStr_(p.name, 'Product name', 100, true);
  var form = vEnum_(p.detail_form || 'simple', DETAIL_FORMS, 'Details form');
  var description = vStr_(p.description, 'Description', 5000);
  var active = vBool_(p.active, true);
  return withLock_(function () {
    var rows = readTable_('Products');
    var id;
    if (p.product_id) {
      var row = mustFind_(rows, 'product_id', vId_(p.product_id, 'Product'), 'product');
      row.name = name; row.detail_form = form; row.description = description; row.active = active;
      updateRow_('Products', row);
      id = row.product_id;
    } else {
      id = newId_('PRD');
      appendRows_('Products', [{
        product_id: id, name: name, detail_form: form, active: active,
        sort: maxSort_(rows) + 1, description: description
      }]);
      // Every product needs at least one package.
      appendRows_('Packages', [{
        package_id: newId_('PKG'), product_id: id, name: 'Custom', price_note: '', sort: 1, active: true
      }]);
    }
    return { id: id, catalog: freshCatalog_() };
  });
}

/** catalog.savePackage: { package_id?, product_id (new only), name, price_note, active, lines? } */
function savePackage_(p) {
  var name = vStr_(p.name, 'Package name', 100, true);
  var priceNote = vStr_(p.price_note, 'Price note', 50);
  var active = vBool_(p.active, true);
  var lines = p.lines === undefined ? null : validLines_(p.lines);
  return withLock_(function () {
    var rows = readTable_('Packages');
    var id;
    if (p.package_id) {
      var row = mustFind_(rows, 'package_id', vId_(p.package_id, 'Package'), 'package');
      row.name = name; row.price_note = priceNote; row.active = active;
      updateRow_('Packages', row);
      id = row.package_id;
    } else {
      var productId = vId_(p.product_id, 'Product');
      mustFind_(readTable_('Products'), 'product_id', productId, 'product');
      id = newId_('PKG');
      var siblings = rows.filter(function (r) { return r.product_id === productId; });
      appendRows_('Packages', [{
        package_id: id, product_id: productId, name: name, price_note: priceNote,
        sort: maxSort_(siblings) + 1, active: active
      }]);
    }
    if (lines) replaceLines_(id, lines);
    return { id: id, catalog: freshCatalog_() };
  });
}

/** catalog.saveTemplateLines: { package_id, lines: [{ template_line_id?, label, amount_cents, kind }] } */
function saveTemplateLines_(p) {
  var packageId = vId_(p.package_id, 'Package');
  var lines = validLines_(p.lines);
  return withLock_(function () {
    mustFind_(readTable_('Packages'), 'package_id', packageId, 'package');
    replaceLines_(packageId, lines);
    return { id: packageId, catalog: freshCatalog_() };
  });
}

function validLines_(lines) {
  if (!Array.isArray(lines)) throw appError('VALIDATION', 'The package lines are missing.');
  if (lines.length > MAX_TEMPLATE_LINES) throw appError('VALIDATION', 'A package can have up to ' + MAX_TEMPLATE_LINES + ' lines.');
  return lines.map(function (l, i) {
    var n = i + 1;
    return {
      template_line_id: typeof l.template_line_id === 'string' && l.template_line_id ? l.template_line_id.slice(0, 64) : '',
      label: vStr_(l.label, 'Line ' + n + ' description', 200, true),
      amount_cents: vCents_(l.amount_cents, 'Line ' + n + ' amount'),
      kind: vEnum_(l.kind || 'base', LINE_KINDS, 'Line ' + n + ' type')
    };
  });
}

/** Replace one package's template lines, keeping every other package's lines. */
function replaceLines_(packageId, lines) {
  var keep = readTable_('TemplateLines').filter(function (l) { return l.package_id !== packageId; });
  var fresh = lines.map(function (l, i) {
    return {
      template_line_id: l.template_line_id || newId_('TL'), package_id: packageId,
      label: l.label, amount_cents: l.amount_cents, kind: l.kind, sort: i + 1
    };
  });
  rewriteTable_('TemplateLines', keep.concat(fresh));
}

/** catalog.saveAddOn: { addon_id?, product_id (new only), label, amount_cents, price_editable, rule, active } */
function saveAddOn_(p) {
  var label = vStr_(p.label, 'Add-on description', 200, true);
  var amount = vCents_(p.amount_cents, 'Add-on amount');
  var editable = vBool_(p.price_editable, false);
  var rule = vEnum_(p.rule || '', ADDON_RULES, 'Add-on rule');
  var active = vBool_(p.active, true);
  return withLock_(function () {
    var rows = readTable_('AddOns');
    var id;
    if (p.addon_id) {
      var row = mustFind_(rows, 'addon_id', vId_(p.addon_id, 'Add-on'), 'add-on');
      row.label = label; row.amount_cents = amount; row.price_editable = editable; row.rule = rule; row.active = active;
      updateRow_('AddOns', row);
      id = row.addon_id;
    } else {
      var productId = vId_(p.product_id, 'Product');
      mustFind_(readTable_('Products'), 'product_id', productId, 'product');
      id = newId_('ADD');
      var siblings = rows.filter(function (r) { return r.product_id === productId; });
      appendRows_('AddOns', [{
        addon_id: id, product_id: productId, label: label, amount_cents: amount,
        price_editable: editable, rule: rule, sort: maxSort_(siblings) + 1, active: active
      }]);
    }
    return { id: id, catalog: freshCatalog_() };
  });
}

/** catalog.savePatch: { original_patch_no? (when editing), patch_no, name, size, tier, group, active } */
function savePatch_(p) {
  var no = vStr_(p.patch_no, 'Patch number', 10, true);
  if (!/^[A-Za-z0-9-]+$/.test(no)) throw appError('VALIDATION', 'Patch number can only use letters, numbers and dashes.');
  var name = vStr_(p.name, 'Patch name', 100, true);
  var size = vStr_(p.size, 'Size', 50);
  var tier = vEnum_(p.tier || 'standard', PATCH_TIERS, 'Tier');
  var group = vEnum_(p.group || PATCH_GROUPS[0], PATCH_GROUPS, 'Group');
  var active = vBool_(p.active, true);
  return withLock_(function () {
    var rows = readTable_('Patches');
    var original = p.original_patch_no ? String(p.original_patch_no) : '';
    var clash = findBy_(rows, 'patch_no', no);
    if (clash && no !== original) throw appError('VALIDATION', 'Patch No. ' + no + ' already exists. Choose another number.');
    if (original) {
      var row = mustFind_(rows, 'patch_no', original, 'patch');
      row.patch_no = no; row.name = name; row.size = size; row.tier = tier; row.group = group; row.active = active;
      updateRow_('Patches', row);
    } else {
      appendRows_('Patches', [{ patch_no: no, name: name, size: size, tier: tier, group: group, active: active, photo_file_id: '' }]);
    }
    return { id: no, catalog: freshCatalog_() };
  });
}

var REORDER_TABLES = {
  products: { table: 'Products', id: 'product_id' },
  packages: { table: 'Packages', id: 'package_id' },
  addOns: { table: 'AddOns', id: 'addon_id' }
};

/** catalog.reorder: { kind: 'products'|'packages'|'addOns', ids: [...] } sets sort to the given order. */
function reorderCatalog_(p) {
  var spec = REORDER_TABLES[p.kind];
  if (!spec) throw appError('VALIDATION', 'Nothing to reorder.');
  if (!Array.isArray(p.ids) || p.ids.length > 200) throw appError('VALIDATION', 'The new order is missing.');
  return withLock_(function () {
    var rows = readTable_(spec.table);
    var changed = [];
    p.ids.forEach(function (id, i) {
      var row = findBy_(rows, spec.id, String(id));
      if (row && row.sort !== i + 1) { row.sort = i + 1; changed.push(row); }
    });
    updateRows_(spec.table, changed);
    return { catalog: freshCatalog_() };
  });
}
