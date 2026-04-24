// Home / landing screen.
// The sidebar is the primary navigation now, so this screen is a small
// onboarding panel: either welcome the user or auto-route them to the
// most recent snapshot.

import { h, mount } from '../ui/dom.js';
import { t } from '../i18n/index.js';
import { icon, iconTile } from '../ui/icon.js';

export function renderHome(root, ctx) {
  const snapshots = ctx.db.listSnapshots();

  // If the user already has snapshots, send them straight to the most recent
  // one — matches Settings-app-less dashboard pattern (no redundant landing).
  if (snapshots.length > 0) {
    ctx.navigate(`/snapshot/${snapshots[0].id}`);
    return;
  }

  mount(root, h('div', { class: 'page landing' }, [
    h('div', { class: 'landing-card' }, [
      iconTile('chart.bar', '--accent', { size: 64, iconSize: 32 }),
      h('h1', { class: 'landing-title' }, t('home.empty.title')),
      h('p', { class: 'landing-desc' }, t('home.empty.desc')),
      h('button', {
        class: 'btn primary large',
        type: 'button',
        onClick: () => ctx.navigate('/upload'),
      }, [
        icon('plus', { size: 18, color: '#fff' }),
        h('span', {}, t('home.empty.cta')),
      ]),
    ]),
  ]));
}
