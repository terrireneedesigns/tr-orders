// screens/settings.js: Settings tab. Business info (read-only for now), Google Sheet link,
// sign out, sign out all devices, app version.
import { APP_VERSION } from '../config.js';
import { call, clearToken } from '../api.js';
import { h, confirmDialog, toast, setChildren, toggleRow, showError, formatDateTime } from '../ui.js';
import { store, loadBootstrap } from '../store.js';
import { signedOut } from '../app.js';

export default {
  title: 'Settings',
  tab: 'settings',
  render(main) {
    const draw = () => {
      const s = store.data.settings;
      setChildren(main, 
        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Business'),
          h('ul', { class: 'list' },
            row('Name', s.business_name), row('Phone', s.phone), row('Email', s.email), row('Website', s.website))),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Zelle'),
          h('ul', { class: 'list' },
            row('Send to', s.zelle_contact), row('Name shown', s.zelle_display_name))),

        h('section', { class: 'section' },
          h('h2', { class: 'label' }, 'Emails'),
          h('p', { class: 'small muted' }, 'When a customer approves or declines a quote, an email goes to ' + (s.notify_email || 'the business inbox') + '.'),
          digestToggle(s)),

        h('section', { class: 'section stack' },
          h('h2', { class: 'label' }, 'Data'),
          store.data.sheetUrl
            ? h('a', { class: 'btn btn-secondary btn-block', href: store.data.sheetUrl, target: '_blank', rel: 'noopener' }, 'Open the Google Sheet')
            : null,
          backupButton(),
          h('p', { class: 'small muted' }, 'A copy is also saved every night at about 2 AM. Copies are kept for 30 days.')),

        h('section', { class: 'section stack' },
          h('h2', { class: 'label' }, 'Sign in'),
          h('button', { class: 'btn btn-secondary btn-block', onclick: signOut }, 'Sign out'),
          h('button', { class: 'btn btn-danger btn-block', onclick: signOutAll }, 'Sign out all devices')),

        h('p', { class: 'section small muted center' },
          'TR Orders app ' + APP_VERSION + ' · server ' + (store.data.apiVersion || '?')));
    };
    draw();
    return async () => { await loadBootstrap(); draw(); };
  }
};

function row(label, value) {
  return h('li', null, h('div', { class: 'list-row' },
    h('div', { class: 'grow' }, h('div', { class: 'small muted' }, label), h('div', null, value || '—'))));
}

async function signOut() {
  const ok = await confirmDialog({ title: 'Sign out?', message: 'You will need the passcode to open TR Orders again on this device.', yes: 'Sign out' });
  if (!ok) return;
  try { await call('auth.logout'); } catch (err) { /* still sign out on this device */ }
  clearToken();
  signedOut('You are signed out.');
}

async function signOutAll() {
  const ok = await confirmDialog({
    title: 'Sign out all devices?',
    message: 'Every phone and computer signed in to TR Orders, including this one, will need the passcode again. Use this if a phone is lost.',
    yes: 'Sign out all devices',
    danger: true
  });
  if (!ok) return;
  try {
    await call('auth.logoutAll');
  } catch (err) {
    if (err.code !== 'AUTH') { toast(err.message, { error: true }); return; }
  }
  clearToken();
  signedOut('All devices are signed out.');
}

function digestToggle(s) {
  const row = toggleRow('Daily summary email', s.daily_digest === 'on', 'About 8 AM, only on days with overdue or ready-but-not-picked-up orders.');
  row.input.addEventListener('change', async () => {
    const on = row.input.checked;
    try {
      store.data.settings = await call('settings.save', { values: { daily_digest: on ? 'on' : 'off' } });
      toast(on ? 'Daily summary turned on' : 'Daily summary turned off');
    } catch (err) {
      row.input.checked = !on;
      showError(err);
    }
  });
  return row;
}

function backupButton() {
  const result = h('div');
  const btn = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, 'Back up now');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Backing up…';
    try {
      const r = await call('backup.run');
      toast('Backup saved');
      setChildren(result, h('p', { class: 'small' }, 'Saved "' + r.name + '" at ' + formatDateTime(new Date().toISOString()) + '. ',
        h('a', { href: r.url, target: '_blank', rel: 'noopener' }, 'Open it')));
    } catch (err) {
      showError(err);
    }
    btn.disabled = false;
    btn.textContent = 'Back up now';
  });
  return h('div', { class: 'stack' }, btn, result);
}
