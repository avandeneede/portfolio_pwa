// Upload screen: pick snapshot date + files, parse in browser, route to preview.

import { h, mount } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { toast } from '../ui/toast.js';
import { parseFile } from '../ingest/parser.js';

function monthLabelFr(d) {
  const months = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
                  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function renderUpload(root, ctx) {
  const today = new Date().toISOString().slice(0, 10);
  const state = { date: today, files: [], busy: false };

  const dateInput = h('input', {
    type: 'date',
    value: state.date,
    onChange: (e) => { state.date = e.target.value; },
  });

  const fileInput = h('input', {
    type: 'file',
    multiple: true,
    accept: '.xlsx,.xls',
    onChange: (e) => { state.files = [...e.target.files]; renderFileList(); updateCta(); },
  });

  const fileList = h('div', { class: 'form-hint' });
  function renderFileList() {
    mount(fileList, state.files.length === 0
      ? t('upload.files.hint')
      : state.files.map((f) => h('div', {}, `• ${f.name} (${Math.round(f.size / 1024)} KB)`)));
  }
  renderFileList();

  const cta = h('button', {
    class: 'btn',
    onClick: handleSubmit,
  }, t('upload.cta'));
  function updateCta() {
    cta.disabled = state.busy || state.files.length === 0;
    cta.textContent = state.busy ? t('common.loading') : t('upload.cta');
  }
  updateCta();

  async function handleSubmit() {
    if (state.files.length === 0) {
      toast(t('upload.error.no_files'), 'danger');
      return;
    }
    state.busy = true; updateCta();
    try {
      const XLSX = await ctx.loadXLSX();
      const parsed = [];
      for (const f of state.files) {
        const buf = await f.arrayBuffer();
        const result = await parseFile(XLSX, buf, f.name);
        parsed.push(result);
      }
      const hasClients = parsed.some((p) => p.type === 'clients');
      if (!hasClients) {
        toast(t('upload.error.clients_required'), 'danger');
        state.busy = false; updateCta();
        return;
      }
      const snapshotDate = new Date(state.date);
      ctx.pendingUpload = {
        snapshotDate: state.date,
        label: monthLabelFr(snapshotDate),
        parsed,
      };
      ctx.navigate('/preview');
    } catch (e) {
      console.error(e);
      toast(t('error.parse') + ' ' + e.message, 'danger');
      state.busy = false; updateCta();
    }
  }

  mount(root, h('div', { class: 'wrap' }, [
    h('div', { class: 'nav' }, [
      h('button', { class: 'back', onClick: () => ctx.navigate('/') }, '‹ ' + t('nav.back')),
      h('div', { class: 'title' }, t('upload.title')),
      h('div', { style: { width: '60px' } }),
    ]),
    h('div', { class: 'form-group' }, [
      h('div', { class: 'form-row' }, [
        h('label', {}, t('upload.date')),
        dateInput,
      ]),
      h('div', { class: 'form-row' }, [
        h('label', {}, t('upload.files')),
        fileInput,
      ]),
    ]),
    fileList,
    h('div', { style: { marginTop: '24px' } }, cta),
  ]));
}
