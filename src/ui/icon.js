// SF Symbols–inspired SVG icons, built programmatically (CSP-safe, no innerHTML).
//
// Usage:
//   icon('chart.bar')                           // 20×20 inline icon
//   icon('chart.bar', { size: 24, color: '--accent' })
//   iconTile('chart.bar', '--accent')           // colored rounded tile
//
// Every icon is a viewBox 24 24 monoline glyph. Pass a CSS variable name
// (e.g. '--accent') for `color` and it resolves to var(--accent) for easy
// theming. Plain hex also works.

const NS = 'http://www.w3.org/2000/svg';

// Path definitions. Each entry is an array of {d, fill?} path specs.
// Monoline style to match SF Symbols "Regular" weight.
const PATHS = {
  // Navigation
  'house': [
    { d: 'M3 11l9-8 9 8M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10' },
  ],
  'plus': [
    { d: 'M12 5v14M5 12h14' },
  ],
  'plus.circle': [
    { d: 'M12 8v8M8 12h8' },
    { d: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  ],
  'gear': [
    { d: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z' },
    { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' },
  ],

  // Objects
  'doc.text': [
    { d: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z' },
    { d: 'M14 3v6h6M8 13h8M8 17h5' },
  ],
  'doc.on.doc': [
    { d: 'M8 4h10a2 2 0 0 1 2 2v10M16 8H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2z' },
  ],
  'folder': [
    { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' },
  ],
  'tray.and.arrow.up': [
    { d: 'M12 3v10M8 7l4-4 4 4' },
    { d: 'M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M4 14h5l1 2h4l1-2h5' },
  ],
  'tray.and.arrow.down': [
    { d: 'M12 14V4M8 10l4 4 4-4' },
    { d: 'M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M4 14h5l1 2h4l1-2h5' },
  ],
  'arrow.down.circle': [
    { d: 'M12 7v10M8 13l4 4 4-4' },
    { d: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  ],
  'arrow.up.circle': [
    { d: 'M12 17V7M8 11l4-4 4 4' },
    { d: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  ],

  // Status / indicators
  'checkmark.circle': [
    { d: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
    { d: 'M8 12l3 3 5-6' },
  ],
  'exclamationmark.triangle': [
    { d: 'M10.3 3.9L2.5 17.2A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z' },
    { d: 'M12 9v4M12 17h.01' },
  ],
  'info.circle': [
    { d: 'M12 8.25h.01M11 12h1v5h1' },
    { d: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  ],
  'questionmark.circle': [
    { d: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
    { d: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7M12 17h.01' },
  ],

  // Actions
  'chevron.left': [{ d: 'M15 6l-6 6 6 6' }],
  'chevron.right': [{ d: 'M9 6l6 6-6 6' }],
  'chevron.down': [{ d: 'M6 9l6 6 6-6' }],
  'trash': [
    { d: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 11v6M14 11v6' },
  ],
  'arrow.clockwise': [
    { d: 'M4 12a8 8 0 0 1 13-6l3 2M20 12a8 8 0 0 1-13 6l-3-2M20 4v4h-4M4 20v-4h4' },
  ],
  'lock': [
    { d: 'M6 11V8a6 6 0 1 1 12 0v3' },
    { d: 'M5 11h14v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9z' },
    { d: 'M12 15v3' },
  ],
  'key': [
    { d: 'M15 8a4 4 0 1 0-4 4 4 4 0 0 0 4-4z', fill: 'none' },
    { d: 'M11 12l-7 7v3h3l7-7' },
  ],
  'globe': [
    { d: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18' },
  ],

  // Data / analytics
  'chart.bar': [
    { d: 'M4 20V10M10 20V4M16 20v-8M22 20H2' },
  ],
  'chart.pie': [
    { d: 'M21 12a9 9 0 1 1-9-9v9h9z' },
  ],
  'map.pin': [
    { d: 'M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z' },
    { d: 'M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
  ],
  'person.2': [
    { d: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
    { d: 'M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2' },
    { d: 'M17 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9' },
  ],
  'building.2': [
    { d: 'M3 21V8l6-4v17M9 21V10l10-4v15M3 21h18' },
    { d: 'M13 11h2M13 15h2M13 19h2M6 12h0M6 16h0M6 20h0' },
  ],
  'wand.and.stars': [
    { d: 'M5 19L19 5M15 5l4 4M9 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2zM19 13l.7 1.3L21 15l-1.3.7L19 17l-.7-1.3L17 15l1.3-.7L19 13z' },
  ],
  'shield.checkmark': [
    { d: 'M12 3l8 3v6c0 4-3.5 7.5-8 9-4.5-1.5-8-5-8-9V6l8-3z' },
    { d: 'M9 12l2 2 4-4' },
  ],
  'clock': [
    { d: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7v5l3 2' },
  ],
  'list.bullet': [
    { d: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
  ],

  // Opportunities / misc
  'arrow.up.arrow.down': [
    { d: 'M7 3v14M3 7l4-4 4 4M17 21V7M13 17l4 4 4-4' },
  ],
  'clock.arrow.circlepath': [
    { d: 'M21 12a9 9 0 1 1-9-9M12 7v5l3 2M16 3h5v5' },
  ],
  'figure.2': [
    { d: 'M8 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM16 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 22v-7l-2-4 2-4h4l2 4-2 4v7M14 22v-7l-2-4 2-4h4l2 4-2 4v7' },
  ],
  'star': [
    { d: 'M12 2l2.9 6.9 7.1.6-5.4 4.6 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.5l7.1-.6L12 2z' },
  ],

  // Language / flag (generic)
  'character.bubble': [
    { d: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z' },
  ],

  // Demographics / identity
  'person.crop.circle': [
    { d: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
    { d: 'M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z' },
    { d: 'M5.5 19a7 7 0 0 1 13 0' },
  ],
  'heart': [
    { d: 'M12 21s-7-4.5-9.3-9.1A5.2 5.2 0 0 1 12 6a5.2 5.2 0 0 1 9.3 5.9C19 16.5 12 21 12 21z' },
  ],
  'briefcase': [
    { d: 'M4 8h16a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a1 1 0 0 1 1-1z' },
    { d: 'M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18' },
  ],
  'envelope': [
    { d: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' },
    { d: 'M3 7l9 7 9-7' },
  ],
  'phone': [
    { d: 'M5 4h3l2 5-2.5 1.5a12 12 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z' },
  ],
  'calendar': [
    { d: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z' },
    { d: 'M4 10h16M8 3v4M16 3v4' },
  ],
  'tag': [
    { d: 'M20 12.6V5a1 1 0 0 0-1-1h-7.6a1 1 0 0 0-.7.3l-7 7a1 1 0 0 0 0 1.4l7.6 7.6a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 .3-.7z' },
    { d: 'M15 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z' },
  ],
  'doc.table': [
    { d: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z' },
    { d: 'M14 3v6h6' },
    { d: 'M7 12h10M7 16h10M10 12v6M14 12v6' },
  ],
};

function resolveColor(c) {
  if (!c) return 'currentColor';
  if (c.startsWith('--')) return `var(${c})`;
  return c;
}

// Create an inline SVG icon element. Works in CSP default-src 'self'
// because we build DOM nodes instead of injecting innerHTML.
export function icon(name, { size = 20, color, strokeWidth = 1.75, className } = {}) {
  const paths = PATHS[name] || PATHS['questionmark.circle'];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', resolveColor(color));
  svg.setAttribute('stroke-width', String(strokeWidth));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (className) svg.setAttribute('class', className);
  for (const p of paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', p.d);
    if (p.fill) path.setAttribute('fill', p.fill);
    svg.appendChild(path);
  }
  return svg;
}

// Colored rounded tile with an icon inside. Matches breakdown's .icon-tile.
export function iconTile(name, tintColor, { size = 34, iconSize = 20 } = {}) {
  const tile = document.createElement('div');
  tile.className = 'icon-tile';
  tile.style.setProperty('--tile-bg', resolveColor(tintColor));
  tile.style.width = `${size}px`;
  tile.style.height = `${size}px`;
  tile.appendChild(icon(name, { size: iconSize, color: '#fff' }));
  return tile;
}
