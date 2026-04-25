// Tiny DOM helpers. No framework. Never innerHTML for user data (CSP/XSS).

/**
 * A child accepted by `h(...)`, `mount(...)`, and friends. We accept anything
 * we can usefully turn into DOM:
 *   - a Node (appended directly),
 *   - a string/number (wrapped in a TextNode),
 *   - null/undefined/false (skipped — useful for inline ternaries),
 *   - or a (possibly nested) array of any of the above.
 *
 * Self-recursive arrays are typed via the `ChildArray` interface trick because
 * TS rejects direct typedef self-reference inside a union.
 *
 * @typedef {Node | string | number | boolean | null | undefined | ChildArray} Children
 */
/** @typedef {Children[]} ChildArray */

/**
 * @typedef {Object.<string, any>} HProps
 *   Property bag for `h()`. Reserved keys: `class`, `dataset`, `style`,
 *   `html` (rejected), and any `on*` event handler. Everything else is
 *   forwarded to setAttribute.
 */

/**
 * Build an Element. Children may be strings, numbers, Nodes, falsy values
 * (skipped), or nested arrays — recursive flattening is intentional so call
 * sites can do `h('div', {}, [a, [b, c], d])` without thinking about it.
 *
 * Throws on `html:` props as a CSP/XSS guard — every styling and content
 * path goes through CSSOM setters and TextNodes.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {HProps} [props]
 * @param {Children} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') applyStyle(el, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') throw new Error('Use children, not html, to avoid XSS');
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  appendChildren(el, children);
  return el;
}

// Apply an inline-style object via the CSSOM. Routing through individual
// setters (and setProperty for CSS custom properties) keeps this CSP-clean
// under `style-src 'self'` — the parsed `style=""` attribute path is what
// 'unsafe-inline' guards, and we never go through that.
/**
 * @param {HTMLElement} el
 * @param {Object.<string, any>} styles
 */
function applyStyle(el, styles) {
  // CSSStyleDeclaration is typed property-by-property in lib.dom; dynamic
  // camelCase keys can't be indexed without a cast. Narrow the cast to a
  // string-indexed record (rather than `any`) and coerce value to string so
  // the cast doesn't bypass type-checking on the value side.
  /** @type {Record<string, string>} */
  const style = /** @type {any} */ (el.style);
  for (const [k, v] of Object.entries(styles)) {
    if (v == null || v === false) continue;
    if (k.startsWith('--')) el.style.setProperty(k, String(v));
    else style[k] = String(v);
  }
}

/**
 * @param {Node} parent
 * @param {Children} children
 */
function appendChildren(parent, children) {
  if (children == null || children === false || children === true) return;
  if (Array.isArray(children)) {
    for (const c of children) appendChildren(parent, c);
    return;
  }
  if (children instanceof Node) parent.appendChild(children);
  else parent.appendChild(document.createTextNode(String(children)));
}

/**
 * @param {Element} el
 */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Replace `container`'s children with `nodes`. Falsy entries are skipped;
 * non-Node entries are wrapped in TextNodes.
 *
 * @param {Element} container
 * @param {...Children} nodes
 */
export function mount(container, ...nodes) {
  clear(container);
  for (const n of nodes) {
    if (n == null || n === false || n === true) continue;
    if (Array.isArray(n)) {
      appendChildren(container, n);
      continue;
    }
    container.appendChild(n instanceof Node ? n : document.createTextNode(String(n)));
  }
}

// Open-one-at-a-time popover helper. Every info button across the app uses
// the same shape: <button>...</button><div class="card-info-popover">…</div>
// where the popover is the button's nextElementSibling. Centralising the
// toggle here gives us two guarantees brokers asked for:
//   1. Opening a new popover closes any other open popover (single-open).
//   2. A global outside-click handler closes whatever is open.
/**
 * @param {Element} triggerBtn
 */
export function togglePopover(triggerBtn) {
  const pop = triggerBtn.nextElementSibling;
  if (!pop || !pop.classList.contains('card-info-popover')) return;
  const willOpen = !pop.classList.contains('is-open');
  document.querySelectorAll('.card-info-popover.is-open').forEach((p) => {
    if (p !== pop) p.classList.remove('is-open');
  });
  pop.classList.toggle('is-open', willOpen);
}

// Wire the global outside-click handler exactly once. Safe to call at module
// load time — `installed` guards against duplicates if the bundle is hot-
// reloaded in a dev session.
let popoverOutsideClickInstalled = false;
export function installPopoverOutsideClick() {
  if (popoverOutsideClickInstalled) return;
  popoverOutsideClickInstalled = true;
  document.addEventListener('click', (e) => {
    const open = document.querySelectorAll('.card-info-popover.is-open');
    if (!open.length) return;
    const target = /** @type {Node|null} */ (e.target);
    for (const p of open) {
      // Click inside the popover itself: leave it alone.
      if (target && p.contains(target)) continue;
      // Click on the trigger button (the popover's previous sibling): the
      // button's own onclick handles toggling; don't double-close here.
      if (target && p.previousElementSibling && p.previousElementSibling.contains(target)) continue;
      p.classList.remove('is-open');
    }
  });
}
installPopoverOutsideClick();
