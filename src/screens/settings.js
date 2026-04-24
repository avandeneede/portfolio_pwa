// Settings screen: profile (user + company), language, backup, danger zone.

import { h, mount } from '../ui/dom.js';
import { t, getLocale } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { backendName, clear as clearLocal } from '../store/local.js';
import { Database } from '../store/db.js';
import { exportEncrypted, importEncrypted, buildFilename, downloadBlob } from '../store/backup.js';
import { loadProfile, saveProfile } from '../store/profile.js';
import { icon, iconTile } from '../ui/icon.js';

function askPassphrase(message) {
  const v = window.prompt(message);
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// A labelled text input row used inside the profile groups. Writes to the
// profile store on blur / Enter so quick edits don't flood localStorage with
// per-keystroke writes. `group` is 'user' or 'company'; `field` is the key.
function profileField(group, field, label, opts = {}) {
  const profile = loadProfile();
  const value = (profile[group] && profile[group][field]) || '';
  const input = h('input', {
    class: 'profile-input',
    type: opts.type || 'text',
    value,
    placeholder: opts.placeholder || '',
    autocomplete: opts.autocomplete || 'off',
    inputmode: opts.inputmode || null,
    onblur: (e) => {
      const next = e.currentTarget.value.trim();
      const patch = {}; patch[group] = {}; patch[group][field] = next;
      saveProfile(patch);
      if (opts.onAfterSave) opts.onAfterSave();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') e.currentTarget.blur();
    },
  });
  return h('label', { class: 'profile-row' }, [
    h('span', { class: 'profile-row-label' }, label),
    input,
  ]);
}

export function renderSettings(root, ctx) {
  const state = { backend: 'unknown', busy: false };

  backendName().then((name) => {
    state.backend = name;
    const el = root.querySelector('[data-backend]');
    if (el) el.textContent = name;
  }).catch(() => {});

  async function handleExport() {
    if (state.busy) return;
    const snapshots = ctx.db.listSnapshots();
    if (snapshots.length === 0) {
      toast(t('settings.backup.no_snapshots'), 'warning');
      return;
    }
    const pass = askPassphrase(t('settings.passphrase.hint') + '\n\n' + t('settings.passphrase.set'));
    if (!pass) {
      toast(t('error.crypto.no_passphrase'), 'danger');
      return;
    }
    const confirm = askPassphrase(t('settings.passphrase.confirm'));
    if (confirm !== pass) {
      toast(t('settings.passphrase.mismatch'), 'danger');
      return;
    }
    state.busy = true;
    try {
      const dbBytes = ctx.db.export();
      const blob = await exportEncrypted(dbBytes, pass);
      const latest = snapshots[0];
      const filename = buildFilename(latest.label, new Date(latest.snapshot_date));
      downloadBlob(blob, filename);
      toast(t('settings.backup.export_done'), 'success');
    } catch (e) {
      console.error(e);
      toast(t('error.generic') + ' ' + e.message, 'danger');
    } finally {
      state.busy = false;
    }
  }

  function handleImport() {
    if (state.busy) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.portefeuille,application/octet-stream';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const pass = askPassphrase(t('settings.backup.passphrase_prompt'));
      if (!pass) {
        toast(t('error.crypto.no_passphrase'), 'danger');
        return;
      }
      state.busy = true;
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const dbBytes = await importEncrypted(buf, pass);
        const newDb = Database.open(dbBytes);
        ctx.db.close();
        ctx.db = newDb;
        await ctx.persistDb();
        toast(t('settings.backup.import_done'), 'success');
        ctx.navigate('/');
      } catch (e) {
        console.error(e);
        const msg = /decrypt|OperationError/i.test(e.message)
          ? t('error.crypto.wrong_passphrase')
          : t('error.generic') + ' ' + e.message;
        toast(msg, 'danger');
      } finally {
        state.busy = false;
      }
    };
    input.click();
  }

  // Full reset: wipe user data AND the PWA's cached code/assets + service
  // worker, then reload. Used when the user wants the app back to a pristine
  // state. This is destructive and asks for confirmation.
  async function handleResetApp() {
    if (state.busy) return;
    if (!window.confirm(t('settings.danger.reset_confirm'))) return;
    state.busy = true;
    try {
      // 1. Close the in-memory DB so no writes race the clear.
      try { ctx.db.close(); } catch (_) { /* ignore */ }
      // 2. Clear the local DB blob (OPFS or IndexedDB, whichever backend).
      await clearLocal();
      // 3. Clear localStorage (profile, locale, any per-user state).
      try { localStorage.clear(); } catch (_) { /* ignore */ }
      // 4. Best-effort: drop every IndexedDB database, not just the portefeuille
      //    one, so nothing stays behind. Not supported everywhere (Firefox pre-126),
      //    hence the feature check.
      try {
        if (typeof indexedDB.databases === 'function') {
          const dbs = await indexedDB.databases();
          await Promise.all(dbs.map((d) => new Promise((res) => {
            if (!d.name) return res();
            const req = indexedDB.deleteDatabase(d.name);
            req.onsuccess = req.onerror = req.onblocked = () => res();
          })));
        }
      } catch (_) { /* ignore */ }
      // 5. Drop all service-worker caches.
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (_) { /* ignore */ }
      // 6. Unregister service workers so the next load fetches fresh code.
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
      } catch (_) { /* ignore */ }
      // 7. Reload. The unregistered SW + cleared caches mean this goes to
      //    the network.
      window.location.reload();
    } catch (e) {
      console.error(e);
      toast(t('error.generic') + ' ' + e.message, 'danger');
      state.busy = false;
    }
  }

  // Force-fetch the latest PWA: drops SW caches + unregisters the worker,
  // then reloads. User data (DB, profile) is untouched. Useful when the
  // network-first strategy still hands back a stale shell (happens after
  // long offline sessions).
  async function handleReloadLatest() {
    if (state.busy) return;
    state.busy = true;
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      toast(t('settings.update.reloading'), 'success');
      // Short delay so the toast paints before the reload blanks the page.
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      console.error(e);
      toast(t('error.generic') + ' ' + e.message, 'danger');
      state.busy = false;
    }
  }

  // ---- Profile helpers ----------------------------------------------------

  // Notify shell after a save so the sidebar reflects the new name / logo.
  const notifyProfileChanged = () => {
    if (typeof ctx.onProfileChanged === 'function') ctx.onProfileChanged();
  };

  // Logo upload: reads the image into a data URL. We cap at ~200KB to keep
  // localStorage small — broker logos are typically tiny; larger images trip
  // a warning instead of silently bloating storage.
  function handleLogoPick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 512 * 1024) {
        toast(t('settings.profile.logo_too_big'), 'warning');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        saveProfile({ company: { logo: dataUrl } });
        toast(t('settings.profile.logo_saved'), 'success');
        notifyProfileChanged();
        // Re-render this screen so the logo preview updates.
        ctx.render(renderSettings);
      };
      reader.onerror = () => toast(t('error.generic'), 'danger');
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function handleLogoClear() {
    if (!window.confirm(t('settings.profile.logo_clear_confirm'))) return;
    saveProfile({ company: { logo: '' } });
    toast(t('settings.profile.logo_cleared'), 'success');
    notifyProfileChanged();
    ctx.render(renderSettings);
  }

  const profile = loadProfile();

  // ---- User profile group -------------------------------------------------
  //
  // Language lives here (not in its own group, not in the sidebar) — it's
  // part of the user's identity, same as name/position/contact.

  const currentLocale = getLocale();
  const langs = [
    { code: 'fr', label: 'FR' },
    { code: 'nl', label: 'NL' },
    { code: 'en', label: 'EN' },
  ];
  const langField = h('div', { class: 'profile-row' }, [
    h('span', { class: 'profile-row-label' }, t('settings.language')),
    h('div', {
      class: 'lang-picker',
      role: 'group',
      'aria-label': t('settings.language'),
    }, langs.map((l) => h('button', {
      class: 'lang-chip' + (l.code === currentLocale ? ' active' : ''),
      type: 'button',
      onClick: () => ctx.setAppLocale(l.code),
    }, l.label))),
  ]);

  const userGroup = h('div', { class: 'group' }, [
    h('div', { class: 'row profile-row-stack' }, [
      iconTile('person.crop.circle', '--indigo'),
      h('div', { class: 'row-main' }, [
        h('div', { class: 'row-title' }, t('settings.profile.user')),
        h('div', { class: 'row-sub' }, t('settings.profile.user_hint')),
      ]),
    ]),
    h('div', { class: 'profile-fields' }, [
      profileField('user', 'name', t('settings.profile.name'), { autocomplete: 'name', onAfterSave: notifyProfileChanged }),
      profileField('user', 'position', t('settings.profile.position'), { autocomplete: 'organization-title' }),
      profileField('user', 'email', t('settings.profile.email'), { type: 'email', autocomplete: 'email' }),
      profileField('user', 'phone', t('settings.profile.phone'), { type: 'tel', inputmode: 'tel', autocomplete: 'tel' }),
      langField,
    ]),
  ]);

  // ---- Company group ------------------------------------------------------

  const logo = profile.company.logo || '';
  const logoPreview = logo
    ? h('div', { class: 'logo-preview' }, [
        h('img', { src: logo, alt: profile.company.name || '' }),
        h('div', { class: 'logo-preview-actions' }, [
          h('button', { class: 'btn ghost', type: 'button', onClick: handleLogoPick },
            t('settings.profile.logo_replace')),
          h('button', { class: 'btn ghost danger', type: 'button', onClick: handleLogoClear },
            t('settings.profile.logo_clear')),
        ]),
      ])
    : h('button', {
        class: 'logo-drop',
        type: 'button',
        onClick: handleLogoPick,
      }, [
        icon('plus', { size: 18, color: '--muted' }),
        h('span', {}, t('settings.profile.logo_add')),
      ]);

  const companyGroup = h('div', { class: 'group' }, [
    h('div', { class: 'row profile-row-stack' }, [
      iconTile('building.2', '--purple'),
      h('div', { class: 'row-main' }, [
        h('div', { class: 'row-title' }, t('settings.profile.company')),
        h('div', { class: 'row-sub' }, t('settings.profile.company_hint')),
      ]),
    ]),
    h('div', { class: 'profile-fields' }, [
      profileField('company', 'name', t('settings.profile.company_name'), { autocomplete: 'organization', onAfterSave: notifyProfileChanged }),
      profileField('company', 'vat', t('settings.profile.vat'), { placeholder: 'BE0000.000.000' }),
      profileField('company', 'address', t('settings.profile.address'), { autocomplete: 'street-address' }),
    ]),
    h('div', { class: 'profile-logo-block' }, [
      h('div', { class: 'profile-logo-label' }, t('settings.profile.logo')),
      logoPreview,
    ]),
  ]);

  mount(root, h('div', { class: 'page' }, [
    h('div', { class: 'page-head' }, [
      h('div', { class: 'page-head-main' }, [
        h('h1', { class: 'page-title' }, t('settings.title')),
      ]),
    ]),

    h('div', { class: 'section-head' }, h('span', {}, t('settings.profile.title'))),
    userGroup,
    companyGroup,

    h('div', { class: 'section-head' }, h('span', {}, t('settings.backup.title'))),
    h('div', { class: 'group' }, [
      h('div', { class: 'row' }, [
        iconTile('lock', '--indigo'),
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title' }, t('settings.passphrase.title')),
          h('div', { class: 'row-sub' }, t('settings.passphrase.hint')),
        ]),
      ]),
      h('div', { class: 'row interactive', onClick: handleExport }, [
        iconTile('tray.and.arrow.up', '--accent'),
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title' }, t('settings.backup.export')),
        ]),
        h('div', { class: 'row-chevron' }, icon('chevron.right', { size: 18, color: '--text-tertiary' })),
      ]),
      h('div', { class: 'row interactive', onClick: handleImport }, [
        iconTile('tray.and.arrow.down', '--success'),
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title' }, t('settings.backup.import')),
        ]),
        h('div', { class: 'row-chevron' }, icon('chevron.right', { size: 18, color: '--text-tertiary' })),
      ]),
    ]),

    h('div', { class: 'section-head' }, h('span', {}, t('settings.storage.title'))),
    h('div', { class: 'group' }, [
      h('div', { class: 'row' }, [
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title' }, t('settings.storage.backend')),
        ]),
        h('div', { class: 'row-value', 'data-backend': '' }, state.backend),
      ]),
    ]),

    h('div', { class: 'section-head' }, h('span', {}, t('settings.update.title'))),
    h('div', { class: 'group' }, [
      h('div', { class: 'row interactive', onClick: handleReloadLatest }, [
        iconTile('arrow.up.arrow.down', '--accent'),
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title' }, t('settings.update.reload')),
          h('div', { class: 'row-sub' }, t('settings.update.reload_hint')),
        ]),
        h('div', { class: 'row-chevron' }, icon('chevron.right', { size: 18, color: '--text-tertiary' })),
      ]),
    ]),

    h('div', { class: 'section-head' }, h('span', {}, t('settings.danger.title'))),
    h('div', { class: 'group' }, [
      h('div', { class: 'row interactive', onClick: handleResetApp }, [
        iconTile('trash', '--danger'),
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title', style: { color: 'var(--danger)' } },
            t('settings.danger.reset')),
          h('div', { class: 'row-sub' }, t('settings.danger.reset_hint')),
        ]),
      ]),
    ]),
  ]));
}
