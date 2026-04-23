// Preview screen: shows parsed file summary + warnings before committing to DB.

import { h, mount } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { formatInt } from '../ui/format.js';

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

  const cta = h('button', { class: 'btn', onClick: handleConfirm }, t('preview.confirm'));
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
      toast(t('preview.confirm') + ' ✓', 'success');
      ctx.navigate(`/snapshot/${snapshotId}`);
    } catch (e) {
      console.error(e);
      toast(t('error.generic') + ' ' + e.message, 'danger');
      state.busy = false; updateCta();
    }
  }

  const warnings = pending.parsed.flatMap((p) => (p.warnings || []).map((w) => `${p.filename}: ${w}`));

  mount(root, h('div', { class: 'wrap' }, [
    h('div', { class: 'nav' }, [
      h('button', { class: 'back', onClick: () => ctx.navigate('/upload') }, '‹ ' + t('nav.back')),
      h('div', { class: 'title' }, t('preview.title')),
      h('div', { style: { width: '60px' } }),
    ]),

    h('div', { class: 'section-head' }, h('span', {}, 'Fichiers reconnus')),
    h('div', { class: 'group' },
      pending.parsed.map((p) => h('div', { class: 'row' }, [
        h('div', { class: 'icon-tile',
          style: { '--tile-bg': p.type ? '#34c759' : '#ff9500' } },
          p.type ? '✓' : '?'),
        h('div', { class: 'row-main' }, [
          h('div', { class: 'row-title' }, p.type ? TYPE_LABEL[p.type] : p.filename),
          h('div', { class: 'row-sub' }, p.type
            ? `${p.filename} · ${t('preview.rows', { count: p.row_count }).replace('{count}', formatInt(p.row_count))}`
            : 'Type non reconnu'),
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

    h('div', { style: { marginTop: '24px', display: 'flex', gap: '12px' } }, [
      h('button', {
        class: 'btn secondary',
        onClick: () => { ctx.pendingUpload = null; ctx.navigate('/upload'); },
      }, t('preview.cancel')),
      cta,
    ]),
  ]));
}
