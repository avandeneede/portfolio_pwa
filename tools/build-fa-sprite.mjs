// Fetches Font Awesome 7 free Solid SVGs and builds a single sprite file at
// vendor/fontawesome/fa-sprite.svg. The sprite uses <symbol> elements indexed
// by the SF Symbol-style alias used in src/ui/icon.js, so existing call sites
// like icon('shield.checkmark') keep working.
//
// Run: node tools/build-fa-sprite.mjs
//
// Source: https://github.com/FortAwesome/Font-Awesome/tree/7.x/svgs/solid
// License: CC BY 4.0 (icons), included in the sprite header.

import { writeFile } from 'node:fs/promises';

// Map of internal alias → FA7 icon name (free solid set).
const MAP = {
  // Navigation / structure
  'house': 'house',
  'plus': 'plus',
  'plus.circle': 'circle-plus',
  'gear': 'gear',
  'chevron.left': 'chevron-left',
  'chevron.right': 'chevron-right',
  'chevron.down': 'chevron-down',
  'line.horizontal.3': 'bars',
  'xmark': 'xmark',

  // Documents / files
  'doc.text': 'file-lines',
  'doc.on.doc': 'copy',
  'doc.table': 'table',
  'folder': 'folder',
  'tray.and.arrow.up': 'upload',
  'tray.and.arrow.down': 'download',
  'square.and.arrow.up': 'arrow-up-from-bracket',
  'arrow.down.circle': 'circle-arrow-down',
  'arrow.up.circle': 'circle-arrow-up',

  // Status / indicators
  'checkmark.circle': 'circle-check',
  'exclamationmark.triangle': 'triangle-exclamation',
  'info.circle': 'circle-info',
  'questionmark.circle': 'circle-question',

  // Actions
  'trash': 'trash',
  'arrow.clockwise': 'arrows-rotate',
  'lock': 'lock',
  'key': 'key',
  'globe': 'globe',

  // Data / charts
  'chart.bar': 'chart-column',
  'chart.pie': 'chart-pie',
  'map.pin': 'location-dot',
  'list.bullet': 'list-ul',
  'arrow.up.arrow.down': 'arrows-up-down',
  'clock.arrow.circlepath': 'clock-rotate-left',

  // People / objects
  'person.2': 'users',
  'person.crop.circle': 'circle-user',
  'mars': 'mars',
  'venus': 'venus',
  'building.2': 'building',
  'wand.and.stars': 'wand-magic-sparkles',
  'shield.checkmark': 'shield-halved',
  'clock': 'clock',
  'figure.2': 'people-roof',
  'star': 'star',
  'character.bubble': 'comment',
  'heart': 'heart',
  'briefcase': 'briefcase',
  'envelope': 'envelope',
  'phone': 'phone',
  'calendar': 'calendar',
  'tag': 'tag',
};

const BASE = 'https://raw.githubusercontent.com/FortAwesome/Font-Awesome/7.x/svgs/solid';

async function fetchOne(faName) {
  const url = `${BASE}/${faName}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} → ${res.status}`);
  const text = await res.text();
  // Extract viewBox and the single <path d="..."/>
  const vb = text.match(/viewBox="([^"]+)"/)?.[1];
  const d = text.match(/<path[^>]*\sd="([^"]+)"/)?.[1];
  if (!vb || !d) throw new Error(`Parse failed for ${faName}: ${text.slice(0, 200)}`);
  return { viewBox: vb, d };
}

// Some FA Solid 7 icons have path data that draws OUTSIDE their declared
// viewBox (e.g. the lock shackle reaches y=-32 inside a "0 0 384 512" viewBox,
// gear bolts protrude to y=-16 / y=528). FA's own rendering happens to clip
// these silently because their CSS uses overflow:visible at the icon level,
// but inside a sprite + <use> pipeline the symbol's viewBox creates an SVG
// viewport that DOES clip. Result: visible truncation at the top/bottom of
// affected glyphs.
//
// Each entry below is the actual content bbox of the path in the FA design
// grid: [minX, minY, width, height]. normalizeToSquare uses these to size
// the output viewBox so the full glyph fits.
//
// To find new offenders: build the sprite, load it in a browser, run
// path.getBBox() on each <symbol>'s <path>, and compare against the symbol's
// viewBox. Anything outside needs an entry here.
const BBOX_OVERRIDES = {
  // FA name → [minX, minY, width, height] of the actual path content.
  'gear':            [2, -16, 510, 544],
  'trash':           [0, -16, 448, 528],
  'lock':            [0, -32, 384, 544],
  'location-dot':    [0,   0, 384, 515],
  'arrows-up-down':  [0, -32, 256, 576],
};

// Center the path inside a square viewBox so every symbol renders at the
// same aspect ratio (consumer SVGs are square width=height). FA icons all
// use a 512-unit design grid, but their viewBox width varies (e.g. chevron
// is 320×512). Without normalization, narrow icons get squashed when their
// symbol is referenced from a square parent SVG.
function normalizeToSquare(viewBox, d, faName) {
  // If the icon is in the override list, ignore FA's declared viewBox and
  // use the true path-content bbox so nothing gets clipped.
  const override = BBOX_OVERRIDES[faName];
  const [minX, minY, w, h] = override
    ? override
    : viewBox.split(/\s+/).map(Number);
  const side = Math.max(w, h);
  const offX = (side - w) / 2 - minX;
  const offY = (side - h) / 2 - minY;
  // Wrap the path in a translate so its drawing origin lands on the square's
  // origin. We don't touch the path data itself.
  return {
    viewBox: `0 0 ${side} ${side}`,
    inner: `<g transform="translate(${offX} ${offY})"><path d="${d}"/></g>`,
  };
}

async function main() {
  const entries = await Promise.all(
    Object.entries(MAP).map(async ([alias, faName]) => {
      const { viewBox, d } = await fetchOne(faName);
      const norm = normalizeToSquare(viewBox, d, faName);
      return { alias, faName, viewBox: norm.viewBox, inner: norm.inner };
    })
  );

  const symbols = entries.map(({ alias, faName, viewBox, inner }) =>
    `  <symbol id="${alias}" viewBox="${viewBox}" data-fa="${faName}">${inner}</symbol>`
  ).join('\n');

  const sprite = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Font Awesome 7 Free Solid sprite.
  Built by tools/build-fa-sprite.mjs from
  https://github.com/FortAwesome/Font-Awesome/tree/7.x/svgs/solid

  Icons: CC BY 4.0 (https://fontawesome.com/license/free).
  Each <symbol id="..."> is keyed by the SF Symbols-style alias used in
  src/ui/icon.js so call sites stay stable across the migration.
-->
<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
${symbols}
</svg>
`;

  await writeFile('vendor/fontawesome/fa-sprite.svg', sprite, 'utf8');
  const bytes = Buffer.byteLength(sprite, 'utf8');
  console.log(`Wrote vendor/fontawesome/fa-sprite.svg (${entries.length} icons, ${bytes} bytes)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
