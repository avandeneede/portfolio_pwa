// Preview screen: shows parsed file summary + warnings before committing to DB.

import { h, mount } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { formatInt } from '../ui/format.js';
import { icon, iconTile } from '../ui/icon.js';

const TABLE_OF_TYPE = {
  clients: 'clients',
  polices: 'polices',
  compagnies: 'compagnies_polices',
  sinistres: 'sinistres',
};

const TYPE_LABEL = {
  clients: 'Clients',
  polices: 'Polices',
  compagnies: 'Compagnies / Polices',
  sinistres: 'Sinistres',
};

export function renderPreview(root, ctx) {
  const pending = ctx.pendingUpload;
  if (!pending) {
    ctx.navigate('/upload');
    return;
  }

  const state = { busy: false };

  const cta = h('button', { class: 'btn primary', onClick: handleConfirm }, t('preview.confirm'));
  function updateCta() {
    cta.disabled = state.busy;
    cta.textContent = state.busy ? t('common.loading') : t('preview.confirm');
  }
  updateCta();

  async function handleConfirm() {
    state.busy = true; updateCta();
    try {
      const snapshotId = ctx.db.createSnapshot({
        snapshot_date: pending.snapshotDate,
        label: pending.label,
      });
      for (const p of pending.parsed) {
        if (!p.type) continue;
        const table = TABLE_OF_TYPE[p.type];
        if (!table) continue;
        ctx.db.insertRows(table, snapshotId, p.rows);
      }
      await ctx.persistDb();
      ctx.pendingUpload = null;
      toast(t('preview.confirm'), 'success');
      ctx.navigate(`/snapshot/${snapshotId}`);
    } catch (e) {
      console.error(e);
      toast(t('error.generic') + ' ' + e.message, 'danger');
      state.busy = false; updateCta();
    }
  }

  const warnings = pending.parsed.flatMap((p) => (p.warnings || []).map((w) => `${p.filename}: ${w}`));

  mount(root, h('div', { class: 'page' }, [
    h('div', { class: 'page-head' }, [
      h('div', { class: 'page-head-main' }, [
        h('button', {
          class: 'back-link',
          onClick: () => ctx.navigate('/upload'),
          type: 'button',
        }, [
          icon('chevron.left', { size: 16 }),
          h('span', {}, t('nav.back')),
        ]),
        h('h1', { class: 'page-title' }, t('preview.title')),
      ]),
    ]),

    h('div', { class: 'section-head' }, h('span', {}, t('preview.recognized'))),
    h('div', { class: 'group' },
      pending.parsed.map((p) => h('div', { class: 'row' }, [
        p.type
          ? iconTile('checkmark.circle', '--success')
          : iconTile('questionmark.circle', '--warning'),
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title' }, p.type ? TYPE_LABEL[p.type] : p.filename),
          h('div', { class: 'row-sub' }, p.type
            ? `${p.filename} · ${t('preview.rows', { count: p.row_count }).replace('{count}', formatInt(p.row_count))}`
            : t('preview.type_unknown')),
        ]),
      ]))
    ),

    warnings.length > 0 ? [
      h('div', { class: 'section-head' }, h('span', {}, t('preview.warnings'))),
      h('div', { class: 'group' },
        warnings.map((w) => h('div', { class: 'row' }, [
          h('div', { class: 'row-main' }, [
            h('div', { class: 'row-title', style: { whiteSpace: 'normal', fontSize: '14px' } }, w),
          ]),
        ]))
      ),
    ] : null,

    h('div', { class: 'form-actions' }, [
      h('button', {
        class: 'btn secondary',
        onClick: () => { ctx.pendingUpload = null; ctx.navigate('/upload'); },
      }, t('preview.cancel')),
      cta,
    ]),
  ]));
}
