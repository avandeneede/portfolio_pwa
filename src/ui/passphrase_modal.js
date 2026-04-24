// Passphrase modal.
//
// Replaces window.prompt() for passphrase entry. Uses a real <form> with
// <input type="password"> so iOS Safari / Apple Passwords / 1Password / any
// browser credential manager can detect and offer to save the passphrase —
// something window.prompt() cannot do.
//
// Two modes:
//   - 'set': two fields (new + confirm). Used when creating a backup or
//     linking a cloud-sync file. `autocomplete="new-password"` is the
//     iOS/Keychain trigger for "would you like to save this password?".
//   - 'get': one field. Used when importing a backup.
//     `autocomplete="current-password"` nudges autofill to surface a saved
//     entry.
//
// Returns a Promise<string|null>. Null = user cancelled.

import { h } from './dom.js';
import { t } from '../i18n/index.js';
import { icon } from './icon.js';

export function askPassphraseModal({ mode = 'get', title, message } = {}) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'pp-overlay', role: 'dialog', 'aria-modal': 'true' });

    // The form wrapper is what actually triggers iOS Passwords. The inputs
    // need a `name` attribute, real autocomplete tokens, and the form must
    // have a visible submit button that fires on Enter.
    const form = document.createElement('form');
    form.className = 'pp-form';
    form.autocomplete = 'on';
    // Use a stable action URL — some password managers use the origin+path
    // as the credential key. We never actually submit.
    form.action = '#';

    // Hidden identifier: gives password managers a "username" slot so they
    // can group passphrases per profile. Using the app origin as the ID keeps
    // it stable across sessions.
    const userInput = h('input', {
      type: 'text',
      name: 'username',
      value: 'portefeuille-backup',
      autocomplete: 'username',
      'aria-hidden': 'true',
      tabindex: '-1',
      style: { position: 'absolute', left: '-9999px', width: '1px', height: '1px' },
      readonly: true,
    });

    const passInput = h('input', {
      class: 'pp-input',
      type: 'password',
      name: 'password',
      autocomplete: mode === 'set' ? 'new-password' : 'current-password',
      placeholder: t('settings.passphrase.placeholder') || '',
      required: true,
      minlength: '4',
      autofocus: true,
    });

    const confirmInput = mode === 'set' ? h('input', {
      class: 'pp-input',
      type: 'password',
      name: 'password_confirm',
      autocomplete: 'new-password',
      placeholder: t('settings.passphrase.confirm_placeholder') || '',
      required: true,
      minlength: '4',
    }) : null;

    const errorEl = h('div', { class: 'pp-error', role: 'alert' });

    const cancelBtn = h('button', {
      class: 'pp-btn pp-btn-cancel',
      type: 'button',
      onClick: () => close(null),
    }, t('nav.cancel') || 'Cancel');

    const submitBtn = h('button', {
      class: 'pp-btn pp-btn-primary',
      type: 'submit',
    }, mode === 'set' ? (t('settings.passphrase.save') || 'Save') : (t('settings.passphrase.unlock') || 'Unlock'));

    const header = h('div', { class: 'pp-header' }, [
      h('div', { class: 'pp-icon' }, icon('lock', { size: 20, color: '#fff' })),
      h('div', { class: 'pp-titles' }, [
        h('div', { class: 'pp-title' }, title || t('settings.passphrase.title') || 'Passphrase'),
        message ? h('div', { class: 'pp-message' }, message) : null,
      ]),
    ]);

    const body = h('div', { class: 'pp-body' }, [
      passInput,
      confirmInput,
      errorEl,
    ]);

    const footer = h('div', { class: 'pp-footer' }, [cancelBtn, submitBtn]);

    form.appendChild(userInput);
    form.appendChild(header);
    form.appendChild(body);
    form.appendChild(footer);

    overlay.appendChild(form);

    function close(value) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    }
    document.addEventListener('keydown', onKey);

    // Backdrop click closes.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pass = passInput.value;
      if (!pass || pass.trim().length === 0) {
        errorEl.textContent = t('error.crypto.no_passphrase') || 'Passphrase required';
        return;
      }
      if (mode === 'set') {
        const conf = confirmInput.value;
        if (conf !== pass) {
          errorEl.textContent = t('settings.passphrase.mismatch') || 'Passphrases do not match';
          confirmInput.focus();
          confirmInput.select();
          return;
        }
      }
      // Intentionally do NOT reset the form before resolving — iOS needs the
      // submit to "stick" (field values still present) for the Keychain save
      // prompt to fire. The overlay is removed on close(), which is enough.
      close(pass.trim());
    });

    document.body.appendChild(overlay);
    // Focus after paint so iOS doesn't immediately dismiss the keyboard.
    setTimeout(() => passInput.focus(), 50);
  });
}
