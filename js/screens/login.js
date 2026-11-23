// screens/login.js: passcode sign-in screen.
import { call, setToken, deviceLabel } from '../api.js';
import { h } from '../ui.js';

/**
 * Render the sign-in screen into `root`. `onSuccess` runs after a token is saved.
 * `message` is an optional note shown above the field (e.g. "Please sign in again.").
 */
export function renderLogin(root, { message = '', onSuccess }) {
  document.title = 'TR Orders';
  const error = h('p', { class: 'error', role: 'alert' }, message);
  const input = h('input', {
    class: 'input', id: 'passcode', name: 'passcode', type: 'password',
    inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'current-password',
    required: true, maxlength: '20', 'aria-describedby': 'login-error'
  });
  error.id = 'login-error';
  const button = h('button', { class: 'btn btn-gold btn-block', type: 'submit' }, 'Unlock');

  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const passcode = input.value.trim();
    if (!/^\d{6,20}$/.test(passcode)) {
      error.textContent = 'The passcode is 6 or more numbers.';
      input.focus();
      return;
    }
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Unlocking…';
    try {
      const res = await call('auth.login', { passcode, label: deviceLabel() });
      setToken(res.token);
      input.value = '';
      await onSuccess();
    } catch (err) {
      error.textContent = err.message || 'Something went wrong. Please try again.';
      button.disabled = false;
      button.textContent = 'Unlock';
      input.select();
    }
  } },
  h('label', { class: 'field', for: 'passcode' }, h('span', null, 'Passcode'), input),
  error,
  button);

  root.replaceChildren(h('div', { class: 'login' },
    h('div', { class: 'login-inner' },
      h('img', { src: 'assets/logo-full-sm.png', alt: 'Terri Renee Evolvé', width: '220', height: '184' }),
      h('h1', null, 'TR Orders'),
      form)));
  // Don't pop the keyboard over the logo on phones; focus only on larger screens.
  if (window.matchMedia('(min-width: 768px)').matches) input.focus();
}
