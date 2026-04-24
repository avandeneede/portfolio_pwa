// Tutorial: walks a first-time broker through the app.
//
// Kept as static text in locales so the tutorial stays readable in all three
// supported languages (FR/NL/EN) without any extra tooling. Sections are
// rendered as expandable cards; each card answers one question.

import { h, mount } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { icon, iconTile } from '../ui/icon.js';
import { isSyncSupported } from '../store/cloud_sync.js';

// Each tutorial section is a (title, body) pair. Bodies may contain newlines
// which we render as paragraph breaks. We don't use markdown to keep the
// runtime free of a parser and immune to any markdown-in-translation mishaps.
const SECTIONS = [
  { id: 'overview',   icon: 'star',            tint: '--accent'  },
  { id: 'upload',     icon: 'tray.and.arrow.up', tint: '--indigo' },
  { id: 'dashboard',  icon: 'chart.bar',       tint: '--purple'  },
  { id: 'evolution',  icon: 'chart.bar',       tint: '--teal'    },
  { id: 'snapshots',  icon: 'clock',           tint: '--warning' },
  { id: 'profile',    icon: 'person.crop.circle', tint: '--indigo'},
  { id: 'backup',     icon: 'lock',            tint: '--success' },
  { id: 'sync',       icon: 'tray.and.arrow.up', tint: '--teal'   },
  { id: 'privacy',    icon: 'lock',            tint: '--success' },
  { id: 'reset',      icon: 'arrow.up.arrow.down', tint: '--danger' },
];

// Split a localized body on blank lines into paragraphs. Each paragraph can
// still contain inline newlines which we render as <br> to keep multi-line
// step lists readable.
function paragraphs(bodyText) {
  return String(bodyText || '')
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => {
      const lines = para.split('\n');
      const children = [];
      lines.forEach((line, i) => {
        if (i > 0) children.push(h('br'));
        children.push(line);
      });
      return h('p', {}, children);
    });
}

export function renderTutorial(root, ctx) {
  const cards = SECTIONS
    .filter((s) => {
      // Hide sync section entirely if the browser can't do File System Access.
      if (s.id === 'sync') return isSyncSupported();
      return true;
    })
    .map((s) => h('details', { class: 'tutorial-card' }, [
      h('summary', { class: 'tutorial-summary' }, [
        iconTile(s.icon, s.tint, { size: 36, iconSize: 18 }),
        h('span', { class: 'tutorial-title' }, t(`tutorial.${s.id}.title`)),
        icon('chevron.right', { size: 16, color: '--text-tertiary' }),
      ]),
      h('div', { class: 'tutorial-body' }, paragraphs(t(`tutorial.${s.id}.body`))),
    ]));

  mount(root, h('div', { class: 'page' }, [
    h('div', { class: 'page-head' }, [
      h('div', { class: 'page-head-main' }, [
        h('button', {
          class: 'back-link',
          onClick: () => ctx.navigate('/settings'),
          type: 'button',
        }, [
          icon('chevron.left', { size: 16 }),
          h('span', {}, t('nav.back')),
        ]),
        h('h1', { class: 'page-title' }, t('tutorial.title')),
        h('p', { class: 'page-subtitle' }, t('tutorial.subtitle')),
      ]),
    ]),
    h('div', { class: 'tutorial-list' }, cards),
  ]));
}
