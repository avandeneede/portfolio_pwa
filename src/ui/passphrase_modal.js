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
    // Stable id so the dialog labels itself via aria-labelledby. Suffix
     // avoids collisions if multiple modals could ever be open in succession.
    const titleId = `pp-title-${Date.now().toString(36)}`;
    const overlay = h('div', {
      class: 'pp-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    });

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
      class: 'pp-hidden-username',
      type: 'text',
      name: 'username',
      value: 'portefeuille-backup',
      autocomplete: 'username',
      'aria-hidden': 'true',
      tabindex: '-1',
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
        h('div', { class: 'pp-title', id: titleId }, title || t('settings.passphrase.title') || 'Passphrase'),
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

    // Save the previously focused element so we can restore focus on close —
    // standard a11y pattern for modal dialogs.
    const previouslyFocused = document.activeElement;

    function close(value) {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      // Restore focus to wherever it was before the modal opened. Guard against
      // the element being removed from the DOM in the meantime.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function'
          && document.contains(previouslyFocused)) {
        try { previouslyFocused.focus(); } catch (_) { /* ignore */ }
      }
      resolve(value);
    }

    // Returns the focusable elements inside the form, in tab order. Recomputed
    // on each Tab keypress because confirmInput may not exist (mode === 'get'),
    // and disabled state can change.
    function focusables() {
      return Array.from(form.querySelectorAll(
        'input:not([type=hidden]):not([disabled]):not([tabindex="-1"]),' +
        'button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])'
      ));
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(null); return; }
      // Focus trap: keep Tab cycling within the modal so screen-reader and
      // keyboard users can't tab into the page behind us.
      if (e.key === 'Tab') {
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (!form.contains(active)) {
          // Focus escaped the form somehow — pull it back in.
          e.preventDefault();
          first.focus();
        }
      }
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
