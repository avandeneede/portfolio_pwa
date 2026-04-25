// Font Awesome 7 free Solid icons, served from a single self-hosted SVG
// sprite at vendor/fontawesome/fa-sprite.svg. Sprite symbols are keyed by
// the SF Symbols-style alias the app already uses (e.g. 'shield.checkmark',
// 'doc.text') so call sites stay stable across the migration. CSP-safe:
// no innerHTML; the sprite is fetched and injected as parsed nodes once at
// boot, then each icon reuses it via <use href="#alias"/>.
//
// Usage:
//   icon('chart.bar')                           // 20×20 inline icon
//   icon('chart.bar', { size: 24, color: '--accent' })
//   iconTile('chart.bar', '--accent')           // colored rounded tile
//
// `color` accepts a CSS variable name like '--accent' (resolves to
// var(--accent)) or any CSS color. FA solid glyphs are filled, so the
// SVG's `fill` is set to currentColor and the inline `color` style drives
// the actual hue.
//
// One-time setup: call `await ensureIconSprite()` from the app bootstrap
// before mounting any UI. The icon() factory is sync and assumes the
// sprite is already in the DOM. If it isn't, <use> renders empty until
// the sprite arrives, which is fine for the brief window during boot.

const NS = 'http://www.w3.org/2000/svg';
const SPRITE_URL = 'vendor/fontawesome/fa-sprite.svg';
const SPRITE_DOM_ID = 'fa-sprite-root';
const FALLBACK_NAME = 'questionmark.circle';

let spritePromise = null;
let spriteSymbols = null; // Set of available symbol ids, populated after fetch.

// Fetch the sprite once and inject the parsed <svg> into <body>. Subsequent
// calls return the same in-flight promise. Safe to call multiple times.
export function ensureIconSprite() {
  if (typeof document === 'undefined') return Promise.resolve(); // SSR/test
  if (document.getElementById(SPRITE_DOM_ID)) return Promise.resolve();
  if (spritePromise) return spritePromise;
  spritePromise = (async () => {
    const res = await fetch(SPRITE_URL);
    if (!res.ok) throw new Error(`Icon sprite fetch failed: ${res.status}`);
    const text = await res.text();
    // Parse as XML so we can graft <svg> nodes in without innerHTML.
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') {
      throw new Error('Icon sprite parse failed: no <svg> root');
    }
    root.id = SPRITE_DOM_ID;
    root.style.display = 'none';
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(document.importNode(root, true));
    spriteSymbols = new Set(
      Array.from(root.querySelectorAll('symbol')).map((s) => s.id)
    );
  })();
  return spritePromise;
}

function resolveColor(c) {
  if (!c) return 'currentColor';
  if (c.startsWith('--')) return `var(${c})`;
  return c;
}

// Create an inline SVG icon that references a symbol from the sprite.
export function icon(name, { size = 20, color, className } = {}) {
  // If the sprite is loaded and the name isn't there, fall back so we
  // never render a blank box. Before the sprite finishes loading,
  // spriteSymbols is null and we trust the caller's name.
  const id = (spriteSymbols && !spriteSymbols.has(name)) ? FALLBACK_NAME : name;

  const svg = document.createElementNS(NS, 'svg');
  // Every sprite symbol is normalized to a square 0 0 512 512 viewBox by
  // tools/build-fa-sprite.mjs. Setting it on the parent SVG too matches the
  // symbol's coordinate system and avoids any aspect-ratio surprises across
  // browsers (some treat <use href="#symbol"> + no parent viewBox as 100%
  // intrinsic = stretch, others letterbox).
  svg.setAttribute('viewBox', '0 0 512 512');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'currentColor');
  svg.style.color = resolveColor(color);
  svg.style.verticalAlign = 'middle';
  svg.style.flexShrink = '0';
  if (className) svg.setAttribute('class', className);

  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
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
