// money.js: all money is integer cents. These helpers turn cents into "$1,234.56" and back.

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** 27500 -> "$275.00", -300 -> "-$3.00". */
export function formatCents(cents) {
  const n = Number(cents) || 0;
  return fmt.format(n / 100);
}

/** 27500 -> "275.00" (for filling an input box). */
export function centsToInput(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
}

/**
 * Read what someone typed as money. Accepts "275", "275.5", "$1,234.56", "-3", "(3.00)".
 * Returns integer cents, or null if it isn't a valid amount. Never uses floating point
 * for the cents part, so "0.29" is exactly 29.
 */
export function parseMoney(text) {
  if (text === null || text === undefined) return null;
  let s = String(text).trim().replace(/[$,\s]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (s.startsWith('$')) s = s.slice(1);
  const m = s.match(/^(\d*)(?:\.(\d{0,2}))?$/);
  if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) return null;
  const dollars = m[1] === '' ? 0 : parseInt(m[1], 10);
  const cents = m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0;
  const total = dollars * 100 + cents;
  if (!Number.isSafeInteger(total)) return null;
  return negative ? -total : total;
}

/** Sum of amount_cents over a list of lines. */
export function sumCents(lines) {
  return lines.reduce((t, l) => t + (Number(l.amount_cents) || 0), 0);
}
