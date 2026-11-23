// screens/settings.js: Settings tab. Business info (read-only for now), Google Sheet link,
// sign out, sign out all devices, app version.
import { APP_VERSION } from '../config.js';
import { call, clearToken } from '../api.js';
import { h, confirmDialog, toast, setChildren } from '../ui.js';
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
          h('h2', { class: 'label' }, 'Data'),
          store.data.sheetUrl
            ? h('a', { class: 'btn btn-secondary btn-block', href: store.data.sheetUrl, target: '_blank', rel: 'noopener' }, 'Open the Google Sheet')
            : null),

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
