// Upload screen: pick snapshot date + files, parse in browser, commit directly.
//
// The old two-step flow (upload -> preview) has been folded into a single
// screen. Four named slots (CLIENTS / POLICES / COMPAGNIES / SINISTRES) show
// live as files are recognized. A file can be replaced by re-selecting it.

import { h, mount } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { formatInt, formatMonthYear, formatDateEU, parseDateEU } from '../ui/format.js';
import { parseFile } from '../ingest/parser.js';
import { icon, iconTile } from '../ui/icon.js';

const SLOTS = [
  { type: 'clients',    iconName: 'person.2',    tint: '--indigo',  table: 'clients'            },
  { type: 'polices',    iconName: 'doc.text',    tint: '--purple',  table: 'polices'            },
  { type: 'compagnies', iconName: 'building.2',  tint: '--teal',    table: 'compagnies_polices' },
  { type: 'sinistres',  iconName: 'shield.checkmark', tint: '--warning', table: 'sinistres'     },
];

export function renderUpload(root, ctx) {
  const today = new Date().toISOString().slice(0, 10);

  // state.slots: map type -> { parsed, file } once a file has been assigned.
  // state.unrecognized: list of parsed results whose type couldn't be detected.
  // state.parseErrors: per-file parse failures, surfaced inline on the page
  // instead of as a stack of toasts. The user can dismiss the whole list with
  // a single click and re-pick the offending files.
  const state = {
    date: today,
    slots: Object.fromEntries(SLOTS.map((s) => [s.type, null])),
    unrecognized: [],
    parseErrors: [],
    busy: false,
  };

  // EU date input: a plain text field formatted as JJ/MM/AAAA so brokers
  // don't get the US mm/dd/yyyy the native date picker gives on English OS.
  // Behind it, a real `type="date"` input is still available via the
  // calendar button for users who prefer the OS picker. Canonical storage
  // stays ISO in state.date.
  const dateInput = h('input', {
    type: 'text',
    class: 'date-eu',
    value: formatDateEU(state.date),
    placeholder: 'JJ/MM/AAAA',
    inputMode: 'numeric',
    autocomplete: 'off',
    'aria-label': t('upload.date'),
    onBlur: (e) => {
      const parsed = parseDateEU(e.target.value);
      if (parsed) {
        state.date = parsed;
        e.target.value = formatDateEU(parsed);
      } else {
        // Revert to last valid value so state never drifts.
        e.target.value = formatDateEU(state.date);
      }
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter') e.currentTarget.blur();
    },
  });
  const nativeDateInput = h('input', {
    type: 'date',
    class: 'date-eu-native',
    value: state.date,
    'aria-hidden': 'true',
    tabIndex: -1,
    onChange: (e) => {
      const iso = e.target.value;
      if (!iso) return;
      state.date = iso;
      dateInput.value = formatDateEU(iso);
    },
  });
  const dateCalendarBtn = h('button', {
    type: 'button',
    class: 'date-eu-btn',
    'aria-label': t('upload.date'),
    onClick: () => {
      // Modern browsers: open the native picker programmatically.
      if (typeof nativeDateInput.showPicker === 'function') {
        try { nativeDateInput.showPicker(); return; } catch (_) { /* fall through */ }
      }
      nativeDateInput.focus();
      nativeDateInput.click();
    },
  }, icon('calendar', { size: 18, color: '--muted' }));
  const dateField = h('div', { class: 'date-eu-field' }, [
    dateInput,
    dateCalendarBtn,
    nativeDateInput,
  ]);

  // Hidden native picker; triggered from the "Choose files" button and from
  // individual "Replace" buttons on each slot.
  const fileInput = h('input', {
    class: 'visually-hidden-input',
    type: 'file',
    multiple: true,
    accept: '.xlsx,.xls',
    onChange: async (e) => {
      const files = [...e.target.files];
      e.target.value = '';  // allow picking the same file twice
      if (files.length === 0) return;
      await handleFiles(files);
    },
  });

  async function handleFiles(files) {
    state.busy = true; render();
    try {
      const XLSX = await ctx.loadXLSX();
      // Parse files in parallel. Typical broker upload is 2-4 small XLSX files,
      // so unbounded concurrency here is fine — no risk of thrashing memory.
      // Each file is wrapped so one bad sheet doesn't reject the whole batch.
      const results = await Promise.all(files.map(async (f) => {
        try {
          const buf = await f.arrayBuffer();
          const parsed = await parseFile(XLSX, buf, f.name);
          // Keep the raw bytes so we can persist them alongside the parsed
          // rows on commit. Enables full re-parse after parser/code changes
          // without re-uploading the source file.
          return { ok: true, f, parsed, buf };
        } catch (err) {
          return { ok: false, f, err };
        }
      }));
      // Collect failures and surface them as a single inline panel rather
      // than a stack of toasts. One toast still fires as a global signal so
      // the user notices something went wrong even if scrolled away.
      const newErrors = [];
      for (const r of results) {
        if (!r.ok) {
          console.error(r.err);
          newErrors.push({ filename: r.f.name, message: r.err.message || String(r.err) });
          continue;
        }
        if (r.parsed.type && state.slots[r.parsed.type] !== undefined) {
          state.slots[r.parsed.type] = { parsed: r.parsed, filename: r.f.name, buf: r.buf };
        } else {
          state.unrecognized.push({ parsed: r.parsed, filename: r.f.name });
        }
      }
      if (newErrors.length > 0) {
        state.parseErrors = state.parseErrors.concat(newErrors);
        toast(t('upload.parse_errors_summary').replace('{count}', String(newErrors.length)), 'danger');
      }
    } finally {
      state.busy = false; render();
    }
  }

  async function handleCommit() {
    const clientsSlot = state.slots.clients;
    if (!clientsSlot) {
      toast(t('upload.error.clients_required'), 'danger');
      return;
    }
    state.busy = true; render();
    try {
      const snapshotDate = state.date;
      const label = formatMonthYear(snapshotDate);
      const snapshotId = ctx.db.createSnapshot({ snapshot_date: snapshotDate, label });
      const sourceFiles = [];
      for (const s of SLOTS) {
        const slot = state.slots[s.type];
        if (!slot) continue;
        ctx.db.insertRows(s.table, snapshotId, slot.parsed.rows);
        if (slot.buf) {
          sourceFiles.push({
            slot_type: s.type,
            filename: slot.filename,
            bytes: new Uint8Array(slot.buf),
          });
        }
      }
      // Stash the raw XLSX bytes in the DB so a later parser/code change can
      // re-derive everything without asking the broker to re-upload.
      if (sourceFiles.length > 0) {
        ctx.db.saveSnapshotFiles(snapshotId, sourceFiles);
      }
      await ctx.persistDb();
      toast(t('preview.confirm'), 'success');
      ctx.navigate(`/snapshot/${snapshotId}`);
    } catch (e) {
      console.error(e);
      toast(t('error.generic') + ' ' + e.message, {
        kind: 'danger',
        duration: 8000,
        action: { label: t('common.retry') || 'Retry', onClick: handleCommit },
      });
      state.busy = false; render();
    }
  }

  function slotCard(slotDef) {
    const slot = state.slots[slotDef.type];
    const filled = !!slot;
    return h('div', {
      class: 'upload-slot' + (filled ? ' filled' : ''),
      onClick: () => fileInput.click(),
      role: 'button',
      tabIndex: 0,
    }, [
      h('div', { class: 'upload-slot-icon' },
        iconTile(slotDef.iconName, slotDef.tint, { size: 44, iconSize: 22 })),
      h('div', { class: 'upload-slot-main' }, [
        h('div', { class: 'upload-slot-title' }, t('upload.slot.' + slotDef.type)),
        filled
          ? h('div', { class: 'upload-slot-meta' }, [
              h('span', { class: 'upload-slot-filename' }, slot.filename),
              h('span', { class: 'upload-slot-rows' },
                `${formatInt(slot.parsed.row_count)} ${t('upload.slot.rows')}`),
            ])
          : h('div', { class: 'upload-slot-waiting' }, t('upload.slot.waiting')),
      ]),
      h('div', { class: 'upload-slot-status' },
        filled
          ? icon('checkmark.circle', { size: 20, color: '--success' })
          : icon('tray.and.arrow.up', { size: 20, color: '--muted' })),
    ]);
  }

  function unrecognizedRow(u) {
    return h('div', { class: 'upload-unrecognized' }, [
      iconTile('questionmark.circle', '--warning', { size: 36, iconSize: 18 }),
      h('div', { class: 'upload-slot-main' }, [
        h('div', { class: 'upload-slot-title' }, u.filename),
        h('div', { class: 'upload-slot-waiting' }, t('upload.slot.unrecognized')),
      ]),
    ]);
  }

  // Re-renders the content area; cheap because there are only a handful of nodes.
  function render() {
    const readyCount = SLOTS.filter((s) => state.slots[s.type]).length;
    const canCommit = !!state.slots.clients && !state.busy;

    mount(root, h('div', { class: 'page' }, [
      h('div', { class: 'page-head' }, [
        h('div', { class: 'page-head-main' }, [
          h('button', {
            class: 'back-link',
            onClick: () => ctx.navigate('/'),
            type: 'button',
          }, [
            icon('chevron.left', { size: 16 }),
            h('span', {}, t('nav.back')),
          ]),
          h('h1', { class: 'page-title' }, t('upload.title')),
        ]),
      ]),

      h('div', { class: 'form-group' }, [
        h('div', { class: 'form-row' }, [
          h('label', {}, t('upload.date')),
          dateField,
        ]),
      ]),

      // Primary CTA up top: the whole point of this screen is picking files,
      // so this is the first obvious thing to click. Slots below just show
      // what landed in which bucket.
      h('div', { class: 'upload-cta' }, [
        h('button', {
          class: 'btn primary upload-cta-btn',
          type: 'button',
          onClick: () => fileInput.click(),
          disabled: state.busy,
        }, [
          icon('tray.and.arrow.up', { size: 18, color: '#fff' }),
          h('span', {}, readyCount > 0 ? t('upload.replace_file') : t('upload.pick_files')),
        ]),
        h('p', { class: 'upload-cta-hint' }, t('upload.files.hint')),
      ]),

      h('div', { class: 'upload-slots' }, SLOTS.map(slotCard)),

      // Inline parse-error panel: one card with a list of failed files instead
      // of a stack of toasts. User can dismiss the whole panel and re-pick.
      state.parseErrors.length > 0
        ? h('div', { class: 'upload-errors', role: 'alert' }, [
            h('div', { class: 'upload-errors-head' }, [
              icon('exclamationmark.triangle', { size: 16, color: '--danger' }),
              h('span', { class: 'upload-errors-title' },
                t('upload.parse_errors_title').replace('{count}', String(state.parseErrors.length))),
              h('button', {
                class: 'upload-errors-dismiss',
                type: 'button',
                'aria-label': t('nav.close') || 'Close',
                onClick: () => { state.parseErrors = []; render(); },
              }, '×'),
            ]),
            h('ul', { class: 'upload-errors-list' },
              state.parseErrors.map((e) => h('li', {}, [
                h('span', { class: 'upload-errors-name' }, e.filename),
                h('span', { class: 'upload-errors-msg' }, e.message),
              ]))),
          ])
        : null,

      state.unrecognized.length > 0
        ? h('div', { class: 'upload-unrec-list' }, state.unrecognized.map(unrecognizedRow))
        : null,

      h('div', { class: 'form-actions' }, [
        h('button', {
          class: 'btn primary',
          type: 'button',
          onClick: handleCommit,
          disabled: !canCommit,
        }, state.busy ? t('common.loading') : t('preview.confirm')),
        fileInput,
      ]),
    ]));
  }

  render();
}
