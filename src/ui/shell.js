// Persistent app shell: sidebar with snapshot list, content slot.
//
// Mounted once at bootstrap. Screens render into `getContentRoot()` instead
// of the global <main>. The sidebar shows the user's snapshots as the primary
// navigation; Settings and the language picker live at the bottom.
//
// Mobile: sidebar becomes a slide-out drawer triggered by a hamburger button
// in a top app bar. The drawer overlays the content with a translucent backdrop
// (iOS-style), so the content is never fighting the nav for vertical space.

import { h, mount } from './dom.js';
import { t } from '../i18n/index.js';
import { icon } from './icon.js';
import { formatDate, formatMonthYear } from './format.js';
import { loadProfile } from '../store/profile.js';

export function renderShell(container, ctx) {
  const app = h('div', { class: 'app' }, [
    renderTopbar(ctx),
    renderDrawerBackdrop(),
    renderSidebar(ctx),
    h('main', { class: 'content' }, [
      h('div', { id: 'content', class: 'content-inner' }),
    ]),
  ]);
  mount(container, app);

  // Auto-close the drawer whenever the route changes. Prevents the drawer from
  // staying open behind a newly rendered screen on mobile.
  window.addEventListener('hashchange', closeDrawer);
}

function currentHashPath() {
  return (location.hash || '#/').slice(1) || '/';
}

function matchSnapshotId(path) {
  const m = /^\/snapshot\/(\d+)$/.exec(path);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Mobile drawer open/close
// ---------------------------------------------------------------------------
function openDrawer() {
  const appEl = document.querySelector('.app');
  if (appEl) appEl.classList.add('drawer-open');
}
function closeDrawer() {
  const appEl = document.querySelector('.app');
  if (appEl) appEl.classList.remove('drawer-open');
}

// Mobile-only top app bar. On desktop it's hidden via CSS.
function renderTopbar(ctx) {
  const profile = loadProfile();
  const companyName = (profile.company && profile.company.name) || '';
  const logoUrl = profile.company && profile.company.logo;
  const brandIcon = logoUrl
    ? h('div', { class: 'brand-icon brand-icon-logo' },
        h('img', { src: logoUrl, alt: companyName || t('app.title') }))
    : h('div', { class: 'brand-icon' }, icon('chart.bar', { size: 20, color: '#fff' }));
  const brandTitle = companyName || t('app.title');

  return h('header', { class: 'mobile-topbar' }, [
    h('button', {
      class: 'topbar-hamburger',
      type: 'button',
      'aria-label': t('nav.menu') || 'Menu',
      onClick: openDrawer,
    }, icon('line.horizontal.3', { size: 22 })),
    h('div', { class: 'topbar-brand' }, [
      brandIcon,
      h('span', { class: 'topbar-title', title: brandTitle }, brandTitle),
    ]),
    h('button', {
      class: 'topbar-new',
      type: 'button',
      'aria-label': t('nav.new_snapshot'),
      onClick: () => ctx.navigate('/upload'),
    }, icon('plus', { size: 20 })),
  ]);
}

function renderDrawerBackdrop() {
  return h('div', {
    class: 'drawer-backdrop',
    onClick: closeDrawer,
    'aria-hidden': 'true',
  });
}

function renderSidebar(ctx) {
  const path = currentHashPath();
  const activeSnapshotId = matchSnapshotId(path);

  // Brand shows the portfolio-holder's logo + company name when the user has
  // configured a profile. Falls back to the generic chart.bar tile + app
  // title/subtitle for fresh installs.
  const profile = loadProfile();
  const companyName = (profile.company && profile.company.name) || '';
  const userName = (profile.user && profile.user.name) || '';
  const logoUrl = profile.company && profile.company.logo;
  const brandIcon = logoUrl
    ? h('div', { class: 'brand-icon brand-icon-logo' },
        h('img', { src: logoUrl, alt: companyName || t('app.title') }))
    : h('div', { class: 'brand-icon' }, icon('chart.bar', { size: 22, color: '#fff' }));
  const brandTitle = companyName || t('app.title');
  const brandSubtitle = companyName
    ? (userName || t('app.subtitle'))
    : t('app.subtitle');
  const brand = h('div', { class: 'app-brand' }, [
    brandIcon,
    h('div', { class: 'brand-text' }, [
      h('div', { class: 'brand-title', title: brandTitle }, brandTitle),
      h('div', { class: 'brand-subtitle', title: brandSubtitle }, brandSubtitle),
    ]),
  ]);

  // Mobile-only close button on the drawer itself. Hidden on desktop.
  const drawerClose = h('button', {
    class: 'drawer-close',
    type: 'button',
    'aria-label': t('nav.close') || 'Close',
    onClick: closeDrawer,
  }, icon('xmark', { size: 18 }));

  // Primary CTA — always visible at top of sidebar.
  const newBtn = h('button', {
    class: 'side-cta' + (path === '/upload' ? ' active' : ''),
    type: 'button',
    onClick: () => ctx.navigate('/upload'),
  }, [
    h('span', { class: 'side-cta-icon' }, icon('plus', { size: 16, color: '#fff' })),
    h('span', {}, t('nav.new_snapshot')),
  ]);

  // Snapshot list. Most-recent first (DB already orders that way).
  let snapshots = [];
  try {
    snapshots = ctx.db ? ctx.db.listSnapshots() : [];
  } catch (_) { /* ignore */ }

  // Only show the "Snapshots" header when there's at least one — an empty
  // grey "No snapshots" card was noise, so we hide the whole section instead.
  const listHeader = snapshots.length === 0 ? null : h('div', { class: 'side-section-head' },
    h('span', {}, t('nav.snapshots')));

  const listBody = snapshots.length === 0
    ? null
    : h('div', { class: 'side-list' },
        snapshots.map((s) => h('a', {
          class: 'side-snapshot' + (s.id === activeSnapshotId ? ' active' : ''),
          href: `#/snapshot/${s.id}`,
          onClick: (e) => {
            e.preventDefault();
            ctx.navigate(`/snapshot/${s.id}`);
          },
        }, [
          h('span', { class: 'side-snapshot-dot' }),
          h('span', { class: 'side-snapshot-main' }, [
            h('span', { class: 'side-snapshot-title' }, formatMonthYear(s.snapshot_date) || s.label),
            h('span', { class: 'side-snapshot-date' }, formatDate(s.snapshot_date)),
          ]),
        ]))
      );

  // Evolution link only makes sense once the user has at least one snapshot.
  const evolutionLink = snapshots.length >= 1 ? h('a', {
    class: 'side-nav-item' + (path === '/evolution' ? ' active' : ''),
    href: '#/evolution',
    onClick: (e) => { e.preventDefault(); ctx.navigate('/evolution'); },
  }, [
    h('span', { class: 'side-nav-icon' }, icon('chart.bar', { size: 18 })),
    h('span', { class: 'side-nav-label' }, t('nav.evolution')),
  ]) : null;

  const settingsLink = h('a', {
    class: 'side-nav-item' + (path === '/settings' ? ' active' : ''),
    href: '#/settings',
    onClick: (e) => { e.preventDefault(); ctx.navigate('/settings'); },
  }, [
    h('span', { class: 'side-nav-icon' }, icon('gear', { size: 18 })),
    h('span', { class: 'side-nav-label' }, t('nav.settings')),
  ]);

  // Language lives in the user profile (Settings) — not in the sidebar.
  const footer = h('div', { class: 'sidebar-footer' }, [
    evolutionLink,
    settingsLink,
  ]);

  const children = [drawerClose, brand, newBtn];
  if (listHeader) children.push(listHeader);
  if (listBody) children.push(listBody);
  children.push(footer);

  return h('aside', { class: 'sidebar' }, children);
}

// Called on every navigation to refresh sidebar (active state, snapshot list)
// without touching #content.
export function refreshSidebar(ctx) {
  const appEl = document.querySelector('.app');
  if (!appEl) return;
  const oldSidebar = appEl.querySelector('.sidebar');
  const newSidebar = renderSidebar(ctx);
  if (oldSidebar) appEl.replaceChild(newSidebar, oldSidebar);
  // Also refresh the mobile topbar — it shows the brand logo/name.
  const oldTopbar = appEl.querySelector('.mobile-topbar');
  const newTopbar = renderTopbar(ctx);
  if (oldTopbar) appEl.replaceChild(newTopbar, oldTopbar);
}

export function getContentRoot() {
  return document.getElementById('content');
}
