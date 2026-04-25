// Structured text parser for info popovers.
//
// Locale strings can mix free-form prose with a few line-level markers so the
// popover renders with hierarchy (intro paragraph, bulleted facts, semantic
// up/down annotations, corrective-action callout). Plain prose without any
// markers still renders as a single paragraph — the parser is fully
// backward-compatible with legacy strings.
//
// Markers (one per line, case-sensitive, exactly one ASCII space after):
//   "• "  → neutral bullet item (use for facts/definitions)
//   "↑ "  → up-direction bullet, green ▲
//   "↓ "  → down-direction bullet, red ▼
//   "🛠 " → corrective-action callout (max 1 per string, but multiple lines OK)
//
// Anything else is treated as a paragraph. Adjacent paragraph lines are joined
// with a single space; a blank line starts a new paragraph.
//
// CSS classes used (defined in app.css):
//   .rich-summary    — paragraph
//   .rich-bullets    — neutral bullet list
//   .rich-moves      — up/down bullet list (semantic colour)
//   .rich-up / .rich-down with .rich-arrow inside
//   .rich-action / .rich-action-label / .rich-action-body
//
// The parser only emits classes, never inline styles, so it stays CSP-clean
// under `style-src 'self'`.

import { h } from './dom.js';

/**
 * Parse a structured-info string and return an array of DOM nodes ready to
 * append into a popover.
 *
 * @param {string} text
 * @param {{actionLabel?: string}} [opts] actionLabel: localized "What to do"
 *   header for the 🛠 callout. Falls back to a 🛠 emoji alone if omitted.
 * @returns {Node[]}
 */
export function renderInfoText(text, opts = {}) {
  if (!text) return [];
  const lines = String(text).split('\n').map((s) => s.trim());

  /** @type {string[][]} */
  const paragraphs = [];
  /** @type {string[]} */
  const bullets = [];
  /** @type {string[]} */
  const ups = [];
  /** @type {string[]} */
  const downs = [];
  /** @type {string[]} */
  const actions = [];

  /** @type {string[]} */
  let currentPara = [];
  const flushPara = () => {
    if (currentPara.length) {
      paragraphs.push(currentPara);
      currentPara = [];
    }
  };

  for (const ln of lines) {
    if (!ln) { flushPara(); continue; }
    if (ln.startsWith('• ')) { flushPara(); bullets.push(ln.slice(2).trim()); continue; }
    if (ln.startsWith('↑ ')) { flushPara(); ups.push(ln.slice(2).trim()); continue; }
    if (ln.startsWith('↓ ')) { flushPara(); downs.push(ln.slice(2).trim()); continue; }
    if (ln.startsWith('🛠 ')) { flushPara(); actions.push(ln.slice(2).trim()); continue; }
    currentPara.push(ln);
  }
  flushPara();

  /** @type {Node[]} */
  const out = [];
  for (const p of paragraphs) {
    out.push(h('p', { class: 'rich-summary' }, p.join(' ')));
  }
  if (bullets.length) {
    out.push(h('ul', { class: 'rich-bullets' },
      bullets.map((b) => h('li', {}, b))));
  }
  if (ups.length || downs.length) {
    /** @type {Node[]} */
    const items = [];
    for (const u of ups) {
      items.push(h('li', { class: 'rich-up' }, [
        h('span', { class: 'rich-arrow' }, '▲'),
        h('span', {}, u),
      ]));
    }
    for (const d of downs) {
      items.push(h('li', { class: 'rich-down' }, [
        h('span', { class: 'rich-arrow' }, '▼'),
        h('span', {}, d),
      ]));
    }
    out.push(h('ul', { class: 'rich-moves' }, items));
  }
  if (actions.length) {
    out.push(h('div', { class: 'rich-action' }, [
      h('div', { class: 'rich-action-label' }, [
        h('span', { class: 'rich-action-icon' }, '🛠'),
        h('span', {}, opts.actionLabel || ''),
      ]),
      ...actions.map((a) => h('p', { class: 'rich-action-body' }, a)),
    ]));
  }
  return out;
}

/**
 * Strip line-level markers and collapse to a single string. Used as the
 * native `title=` fallback so hovering the trigger button still surfaces
 * something useful when JS popovers are disabled.
 *
 * @param {string} text
 */
export function stripInfoMarkers(text) {
  if (!text) return '';
  return String(text)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s
      .replace(/^•\s+/, '')
      .replace(/^↑\s+/, '')
      .replace(/^↓\s+/, '')
      .replace(/^🛠\s+/, ''))
    .join(' · ');
}
