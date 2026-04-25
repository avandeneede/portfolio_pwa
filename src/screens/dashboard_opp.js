// Opportunity-list modal + renderers.
//
// Extracted from dashboard.js to keep the screen file focused on layout.
// `OPP_RENDERERS` maps each opportunity key (cross_sell, succession,
// young_families, high_value, data_quality_cleanup) to a row factory pair:
//   - row(it)     → DOM cells for the on-screen table (clickable tel/mail
//                   links, pill lists, etc.)
//   - xlsxRow(it) → plain values for the xlsx export (no DOM)
//
// `showOppDetail(title, items, renderer, opts)` renders the dialog with focus
// trap + Escape-to-close + aria-labelledby. `opts.ctx` and `opts.snapshot`
// are required for the inline xlsx export button.

import { h } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { formatCurrency, branchLabel } from '../ui/format.js';
import { icon, iconTile } from '../ui/icon.js';
import { exportOppXlsx, downloadBlob, buildOppFilename } from '../store/xlsx_export.js';

// Local copies of small dashboard helpers that the renderers depend on.
// Kept here to avoid circular imports with dashboard.js.
const DQ_ICONS = {
  sexe: 'person.crop.circle',
  date_naissance: 'calendar',
  statut_social: 'briefcase',
  etat_civil: 'heart',
  telephone: 'phone',
  email: 'envelope',
};
function dqFieldIcon(key) { return DQ_ICONS[key] || 'tag'; }

const CRITICAL_CONTACT_KEYS = new Set(['email', 'telephone']);

function contactLink(value, kind) {
  const s = String(value ?? '').trim();
  if (!s || s === '—') return '—';
  if (kind === 'tel') {
    const href = 'tel:' + s.replace(/[^\d+]/g, '');
    return h('a', { href, class: 'contact-link' }, s);
  }
  if (kind === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s;
    return h('a', { href: 'mailto:' + s, class: 'contact-link' }, s);
  }
  return s;
}

// Each renderer provides two row extractors:
//   - `row(it)`  → DOM nodes for the on-screen table (clickable tel/mail links,
//                   pill lists, etc.)
//   - `xlsxRow(it)` → plain strings for the xlsx export (no DOM, phones/emails
//                   as raw values, pill lists joined with commas)
// First column is the client name for every renderer — the modal title
// already tells the user which opportunity list they're looking at, so
// we label column 1 "Client" rather than repeating the section name.
export const OPP_RENDERERS = {
  cross_sell: {
    head: ['Client', t('report.branch'), t('report.postal'), 'Téléphone', 'E-mail'],
    row: (it) => [it.nom || '—', it.current_branch ? branchLabel(it.current_branch) : '—', it.code_postal || '—', contactLink(it.telephone, 'tel'), contactLink(it.email, 'email')],
    xlsxRow: (it) => [it.nom || '', it.current_branch ? branchLabel(it.current_branch) : '', it.code_postal || '', it.telephone || '', it.email || ''],
  },
  succession: {
    head: ['Client', 'Âge', t('report.branch'), 'Téléphone', 'E-mail'],
    row: (it) => [it.nom || '—', String(it.age ?? '—'), (it.current_branches || []).map(branchLabel).join(', ') || '—', contactLink(it.telephone, 'tel'), contactLink(it.email, 'email')],
    xlsxRow: (it) => [it.nom || '', it.age ?? '', (it.current_branches || []).map(branchLabel).join(', '), it.telephone || '', it.email || ''],
  },
  young_families: {
    head: ['Client', 'Âge', t('report.branch'), 'Téléphone', 'E-mail'],
    row: (it) => [it.nom || '—', String(it.age ?? '—'), (it.current_branches || []).map(branchLabel).join(', ') || '—', contactLink(it.telephone, 'tel'), contactLink(it.email, 'email')],
    xlsxRow: (it) => [it.nom || '', it.age ?? '', (it.current_branches || []).map(branchLabel).join(', '), it.telephone || '', it.email || ''],
  },
  high_value: {
    head: ['Client', 'Prime', 'Polices', t('report.branch'), 'Téléphone'],
    row: (it) => [it.nom || '—', formatCurrency(it.premium), String(it.n_policies ?? '—'), (it.current_branches || []).map(branchLabel).join(', ') || '—', contactLink(it.telephone, 'tel')],
    xlsxRow: (it) => [it.nom || '', it.premium ?? '', it.n_policies ?? '', (it.current_branches || []).map(branchLabel).join(', '), it.telephone || ''],
  },
  data_quality_cleanup: {
    head: ['Client', 'Champs manquants', 'Nombre'],
    row: (it) => [
      it.nom || '—',
      h('div', { class: 'dq-pill-list' }, (it.missing_fields || []).map((f) => {
        const critical = CRITICAL_CONTACT_KEYS.has(f);
        const tint = critical ? '--danger' : '--warning';
        return h('span', { class: 'dq-pill' + (critical ? ' dq-pill-critical' : '') }, [
          icon(dqFieldIcon(f), { size: 12, color: tint }),
          h('span', {}, f),
        ]);
      })),
      String(it.missing_count ?? 0),
    ],
    xlsxRow: (it) => [it.nom || '', (it.missing_fields || []).join(', '), it.missing_count ?? 0],
  },
};

export function oppTile(iconName, tint, label, count, desc, onClick) {
  const props = { class: 'opp-tile' + (onClick && count > 0 ? ' opp-tile-clickable' : '') };
  if (onClick && count > 0) {
    props.onclick = onClick;
    props.role = 'button';
    props.tabindex = '0';
    props.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } };
  }
  return h('div', props, [
    iconTile(iconName, tint, { size: 40, iconSize: 22 }),
    h('div', { class: 'opp-tile-main' }, [
      h('div', { class: 'opp-tile-count' }, String(count)),
      h('div', { class: 'opp-tile-label' }, label),
      desc ? h('div', { class: 'opp-tile-desc' }, desc) : null,
      onClick && count > 0 ? h('div', { class: 'opp-tile-chevron', 'aria-hidden': 'true' }, '›') : null,
    ]),
  ]);
}

export function showOppDetail(title, items, renderer, opts = {}) {
  if (!items || items.length === 0) return;
  // Save current focus so we can restore it on close — keyboard users return
  // exactly where they were before the modal stole focus.
  const previouslyFocused = /** @type {HTMLElement|null} */ (document.activeElement);
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (previouslyFocused && typeof previouslyFocused.focus === 'function'
        && document.contains(previouslyFocused)) {
      try { previouslyFocused.focus(); } catch (_) { /* ignore */ }
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    // Focus trap so Tab cycles inside the modal instead of escaping into the
    // dashboard underneath.
    if (e.key === 'Tab') {
      const focusable = /** @type {HTMLElement[]} */ (Array.from(overlay.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
      )));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      else if (!overlay.contains(active)) { e.preventDefault(); first.focus(); }
    }
  };

  // The on-screen table is capped at 500 rows (DOM cost) but the export
  // covers the full list so brokers can prospect every match.
  const bodyRows = items.slice(0, 500).map((it) => h('tr', {},
    renderer.row(it).map((cell) => h('td', {}, cell))
  ));
  const moreNote = items.length > 500
    ? h('div', { class: 'opp-modal-note' }, `+ ${items.length - 500} supplémentaires…`)
    : null;

  const { ctx, snapshot } = opts;
  let exporting = false;
  async function exportXlsx(e) {
    const btn = e.currentTarget;
    if (exporting || !ctx || !renderer.xlsxRow) return;
    exporting = true;
    btn.disabled = true;
    try {
      const rows = items.map((it) => renderer.xlsxRow(it));
      const blob = await exportOppXlsx(ctx, {
        header: renderer.head,
        rows,
        sheetName: title,
      });
      // Omit snapshot.label (broker's own portfolio name) from the filename
      // so shared exports don't carry client-identifying strings like "Dossche".
      const filename = buildOppFilename(title, snapshot?.snapshot_date);
      downloadBlob(blob, filename);
      toast(t('dashboard.export_xlsx_done'), 'success');
    } catch (err) {
      console.error(err);
      toast(t('error.generic') + ' ' + err.message, {
        kind: 'danger',
        duration: 8000,
        action: { label: t('common.retry') || 'Retry', onClick: () => exportXlsx({ currentTarget: btn }) },
      });
    } finally {
      exporting = false;
      btn.disabled = false;
    }
  }

  const exportBtn = (ctx && renderer.xlsxRow)
    ? h('button', {
        class: 'opp-modal-export btn ghost',
        type: 'button',
        onclick: exportXlsx,
      }, [
        icon('tray.and.arrow.up', { size: 14, color: '--accent' }),
        h('span', {}, t('dashboard.export_xlsx')),
      ])
    : null;

  // Stable id so the dialog can name itself via aria-labelledby pointing at
  // the title heading. Suffix avoids collisions when modals re-open.
  const titleId = `opp-modal-title-${Date.now().toString(36)}`;
  const closeBtn = h('button', {
    class: 'opp-modal-close',
    onclick: close,
    'aria-label': t('nav.close') || 'Fermer',
    type: 'button',
  }, '×');
  const overlay = h('div', {
    class: 'opp-modal-overlay',
    onclick: (e) => { if (e.target === overlay) close(); },
  }, [
    h('div', { class: 'opp-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
      h('div', { class: 'opp-modal-head' }, [
        h('h3', { class: 'opp-modal-title', id: titleId }, `${title} · ${items.length}`),
        h('div', { class: 'opp-modal-head-actions' }, [
          exportBtn,
          closeBtn,
        ]),
      ]),
      h('div', { class: 'opp-modal-body' }, [
        h('table', { class: 'opp-modal-table' }, [
          h('thead', {}, h('tr', {}, renderer.head.map((c) => h('th', {}, c)))),
          h('tbody', {}, bodyRows),
        ]),
        moreNote,
      ]),
    ]),
  ]);

  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  // Move focus into the modal so keyboard users land inside the trap.
  setTimeout(() => closeBtn.focus(), 0);
}
