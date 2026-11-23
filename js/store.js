// store.js: data loaded once at start (settings, catalog, customers) shared by every screen.
import { call } from './api.js';

export const store = {
  data: null,      // result of the `bootstrap` action
  loadedAt: 0
};

/** Load (or reload) settings, catalog and customers from the back end. */
export async function loadBootstrap() {
  store.data = await call('bootstrap');
  store.loadedAt = Date.now();
  return store.data;
}

export function clearStore() {
  store.data = null;
  store.loadedAt = 0;
}
