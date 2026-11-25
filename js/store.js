// store.js: data loaded once at start (settings, catalog, customers) shared by every screen.
import { call } from './api.js';
import { BASE_URL } from './config.js';

export const store = {
  data: null,      // result of the `bootstrap` action
  loadedAt: 0
};

/** Load (or reload) settings, catalog and customers from the back end. */
export async function loadBootstrap() {
  // The app's own address lets the back end put links to orders in its emails.
  store.data = await call('bootstrap', { app_url: BASE_URL });
  store.loadedAt = Date.now();
  return store.data;
}

/** Replace the catalog parts of the store with a fresh catalog from a save. */
export function setCatalog(cat) {
  if (!store.data || !cat) return;
  for (const k of ['products', 'packages', 'templateLines', 'addOns', 'patches', 'packageCosts']) store.data[k] = cat[k] || [];
}

/** Add or update one customer in the store (keeps the list sorted by name). */
export function upsertCustomer(c) {
  if (!store.data || !c) return;
  const list = store.data.customers.filter((x) => x.customer_id !== c.customer_id);
  list.push(c);
  list.sort((a, b) => a.name.localeCompare(b.name));
  store.data.customers = list;
}

export function findCustomer(id) {
  return store.data ? store.data.customers.find((c) => c.customer_id === id) || null : null;
}

export function clearStore() {
  store.data = null;
  store.loadedAt = 0;
}
