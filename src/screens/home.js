// Home screen: list of snapshots + CTA to create a new one.

import { h, mount } from '../ui/dom.js';
import { formatDate } from '../ui/format.js';
import { t } from '../i18n/index.js';

export function renderHome(root, ctx) {
  const snapshots = ctx.db.listSnapshots();

  const nav = h('div', { class: 'nav' }, [
    h('div', { class: 'title' }, t('app.title')),
    h('div', { class: 'actions' }, [
      h('button', {
        class: 'action-btn',
        onClick: () => ctx.navigate('/settings'),
        'aria-label': t('nav.settings'),
      }, '⚙︎'),
    ]),
  ]);

  let body;
  if (snapshots.length === 0) {
    body = h('div', { class: 'empty' }, [
      h('div', { class: 'empty-icon' }, '📊'),
      h('div', { class: 'empty-title' }, t('home.empty.title')),
      h('div', { class: 'empty-desc' }, t('home.empty.desc')),
      h('button', {
        class: 'btn',
        onClick: () => ctx.navigate('/upload'),
      }, t('home.empty.cta')),
    ]);
  } else {
    body = [
      h('div', { class: 'section-head' }, [
        h('span', {}, t('nav.snapshots')),
        h('button', {
          class: 'section-action',
          onClick: () => ctx.navigate('/upload'),
        }, '+ ' + t('nav.new_snapshot')),
      ]),
      h('div', { class: 'group' },
        snapshots.map((s) => h('a', {
          class: 'row interactive',
          href: `#/snapshot/${s.id}`,
          'aria-label': s.label,
        }, [
          h('div', { class: 'icon-tile', style: { '--tile-bg': '#007aff' } }, '📅'),
          h('div', { class: 'row-main' }, [
            h('div', { class: 'row-title' }, s.label),
            h('div', { class: 'row-sub' }, formatDate(s.snapshot_date)),
          ]),
          h('div', { class: 'row-chevron' }, '›'),
        ]))
      ),
    ];
  }

  mount(root, h('div', { class: 'wrap' }, [nav, body]));
}
