// Settings screen: passphrase-protected encrypted backup + danger zone.

import { h, mount } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { backendName, clear as clearLocal } from '../store/local.js';
import { Database } from '../store/db.js';
import { exportEncrypted, importEncrypted, buildFilename, downloadBlob } from '../store/backup.js';

// Prompt the user for a passphrase. Minimal modal without any dep.
// For MVP we use window.prompt — quick, keyboard-native, works everywhere.
// Returns string or null if cancelled.
function askPassphrase(message) {
  const v = window.prompt(message);
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
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
      toast('Aucun snapshot à exporter', 'warning');
      return;
    }
    const pass = askPassphrase(t('settings.passphrase.hint') + '\n\n' + t('settings.passphrase.set'));
    if (!pass) {
      toast(t('error.crypto.no_passphrase'), 'danger');
      return;
    }
    const confirm = askPassphrase('Confirmez la phrase de passe.');
    if (confirm !== pass) {
      toast('Les phrases ne correspondent pas.', 'danger');
      return;
    }
    state.busy = true;
    try {
      const dbBytes = ctx.db.export();
      const blob = await exportEncrypted(dbBytes, pass);
      const latest = snapshots[0];
      const filename = buildFilename(latest.label, new Date(latest.snapshot_date));
      downloadBlob(blob, filename);
      toast('Sauvegarde exportée', 'success');
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
      const pass = askPassphrase('Phrase de passe de la sauvegarde :');
      if (!pass) {
        toast(t('error.crypto.no_passphrase'), 'danger');
        return;
      }
      state.busy = true;
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const dbBytes = await importEncrypted(buf, pass);
        // Replace in-memory DB
        const newDb = Database.open(dbBytes);
        ctx.db.close();
        ctx.db = newDb;
        await ctx.persistDb();
        toast('Sauvegarde restaurée', 'success');
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

  async function handleWipe() {
    if (state.busy) return;
    if (!window.confirm(t('settings.danger.wipe_confirm'))) return;
    state.busy = true;
    try {
      await clearLocal();
      // Reset in-memory DB to a fresh blank one
      ctx.db.close();
      ctx.db = Database.create();
      await ctx.persistDb();
      toast('Toutes les données ont été effacées', 'success');
      ctx.navigate('/');
    } catch (e) {
      console.error(e);
      toast(t('error.generic') + ' ' + e.message, 'danger');
    } finally {
      state.busy = false;
    }
  }

  mount(root, h('div', { class: 'wrap' }, [
    h('div', { class: 'nav' }, [
      h('button', { class: 'back', onClick: () => ctx.navigate('/') }, '‹ ' + t('nav.back')),
      h('div', { class: 'title' }, t('settings.title')),
      h('div', { style: { width: '60px' } }),
    ]),

    h('div', { class: 'section-head' }, h('span', {}, t('settings.backup.title'))),
    h('div', { class: 'group' }, [
      h('div', { class: 'row' }, [
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title' }, t('settings.backup.export')),
          h('div', { class: 'row-sub' }, t('settings.passphrase.hint')),
        ]),
      ]),
      h('div', { class: 'row interactive', onClick: handleExport }, [
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title', style: { color: 'var(--accent)' } },
            t('settings.backup.export')),
        ]),
        h('div', { class: 'row-chevron' }, '›'),
      ]),
      h('div', { class: 'row interactive', onClick: handleImport }, [
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title', style: { color: 'var(--accent)' } },
            t('settings.backup.import')),
        ]),
        h('div', { class: 'row-chevron' }, '›'),
      ]),
    ]),

    h('div', { class: 'section-head' }, h('span', {}, 'Stockage')),
    h('div', { class: 'group' }, [
      h('div', { class: 'row' }, [
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title' }, 'Backend'),
        ]),
        h('div', { class: 'row-value', 'data-backend': '' }, state.backend),
      ]),
    ]),

    h('div', { class: 'section-head' }, h('span', {}, t('settings.danger.title'))),
    h('div', { class: 'group' }, [
      h('div', { class: 'row interactive', onClick: handleWipe }, [
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title', style: { color: 'var(--danger)' } },
            t('settings.danger.wipe')),
        ]),
      ]),
    ]),
  ]));
}
