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
