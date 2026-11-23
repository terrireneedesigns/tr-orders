// config.js: the only file to change when the back end URL or web address changes.
// No secrets here: the Web App URL is public by design (security is in the back end).

// Paste the Apps Script Web App URL (ends in /exec). See README, "Deploy the Web App".
export const API_URL = 'https://script.google.com/macros/s/AKfycbwxqF9osxEGizJrbD5aJM0SlIiuNNfy2dJT24C-S4MsihdkQcisEyDVaSnkUmqKotKRZA/exec';

// Bump this with each release. It is shown in Settings and names the offline cache.
export const APP_VERSION = '0.6.0';

// Path of the site on its host: '/tr-orders/' on GitHub Pages, '/' on a custom domain.
// Only used where a full link is needed; the app itself uses relative paths everywhere.
export const BASE_PATH = '/tr-orders/';

// Full base address used to build customer links, for example
// https://<user>.github.io/tr-orders/view.html?id=...
// Worked out from where the app is running, so it is right on GitHub Pages, on a custom
// domain and when testing locally. Replace with a fixed string only if you need to.
export const BASE_URL = new URL('../', import.meta.url).href;
