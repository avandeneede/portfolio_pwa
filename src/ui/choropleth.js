// Inline-SVG choropleth of Belgian communes, keyed by postcode. We render
// every node via createElementNS for CSP safety (style-src 'self' drops any
// stringified `style="..."` attributes — see charts.js for the same pattern).
//
// Data comes from `data/be_municipalities.json`, built by
// `tools/build-municipalities.mjs`:
//   {
//     viewBox: "0 0 1000 H",
//     features: [{ cp, name_fr, name_nl, d }, ...],
//     cpToCanonical: { "1020": "1000", "7973": "7970", ... }   // every Belgian CP
//   }
//
// Matching: broker exports include CP + a localité name. The localité is often
// a sub-area ("STAMBRUGES" inside Beloeil's CP 7973) that doesn't match
// commune name lists. We match strictly by CP via `cpToCanonical`, which was
// built at compile time using point-in-polygon centroids from the spatie CP
// table. No fuzzy name matching, no broker-data quirks.
//
// Colour: continuous (sqrt-interpolated) from --choropleth-low → --choropleth-high.
// Sqrt compresses long tails (one commune with 80 clients next to many with 1).
// Empty communes use --choropleth-empty (neutral fill).
//
// Interaction: hover/focus shows a tooltip with CP, name, count, %. Wheel
// zooms (anchored to cursor), drag pans, double-click resets.

import { icon } from './icon.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DATA_PATH = './data/be_municipalities.json';

const EMPTY_VAR = '--choropleth-empty';
const LOW_VAR = '--choropleth-low';
const HIGH_VAR = '--choropleth-high';

let _cache = null;
let _inflight = null;

export async function loadMunicipalities() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = fetch(DATA_PATH, { cache: 'force-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`muni fetch ${r.status}`);
      return r.json();
    })
    .then((data) => {
      // cpToCanonical is a plain object in JSON. Wrap as a Map for O(1) lookup
      // semantics matching the rest of the codebase.
      const cpToCanonical = new Map(Object.entries(data.cpToCanonical || {}));
      _cache = { ...data, cpToCanonical };
      return _cache;
    })
    .catch((err) => { _inflight = null; throw err; });
  return _inflight;
}

/**
 * Group broker geographic-profile rows (CP, count) by canonical polygon-CP.
 *
 * @param {Array<{code_postal: string, count: number}>} rows
 * @param {Map<string,string>} cpToCanonical
 * @returns {{counts: Map<string,number>, mapped: number, total: number, unmapped: Array}}
 */
export function resolveCountsByPostcode(rows, cpToCanonical) {
  const counts = new Map();
  const unmapped = [];
  let mapped = 0, total = 0;
  for (const r of rows) {
    const cp = String(r.code_postal ?? '').trim();
    const c = r.count || 0;
    total += c;
    if (!cp || cp.toLowerCase() === 'none') {
      unmapped.push({ code_postal: cp, count: c, reason: 'empty' });
      continue;
    }
    const canonical = cpToCanonical.get(cp);
    if (!canonical) {
      unmapped.push({ code_postal: cp, count: c, reason: 'no-polygon' });
      continue;
    }
    counts.set(canonical, (counts.get(canonical) || 0) + c);
    mapped += c;
  }
  return { counts, mapped, total, unmapped };
}

// Continuous colour ramp. Read the two end-stops from CSS so dark mode flips
// them automatically. We compute mix percentages with `color-mix()` which is
// supported in all the browsers we target (modern PWAs, last-2 strategy).
//
// Sqrt scaling: small counts already get a visible tint without long tails
// drowning out everything else. Tunable via `gamma` if needed.
function colorFor(count, max, gamma = 0.5) {
  if (count <= 0 || max <= 0) return `var(${EMPTY_VAR})`;
  const t = Math.min(1, Math.pow(count / max, gamma));
  const pct = (t * 100).toFixed(1);
  // color-mix interpolates in OKLCH which avoids the muddy mid-greys of RGB.
  return `color-mix(in oklch, var(${LOW_VAR}), var(${HIGH_VAR}) ${pct}%)`;
}

/**
 * Build the choropleth SVG with pan/zoom interactions and mount it (plus the
 * tooltip and zoom controls) into `host`. The tooltip and zoom controls are
 * regular DOM nodes positioned absolutely over the SVG — that's how we avoid
 * the SVG-foreignObject shadow-repaint bug (Chrome leaves shadow trails when
 * the foreignObject's bbox doesn't include the box-shadow extent).
 *
 * @param {{
 *   data: { viewBox: string, features: Array<{cp,name_fr,name_nl,d}>, cpToCanonical: Map },
 *   counts: Map<string, number>,             // canonical-CP → client count
 *   total: number,
 *   t: (key: string) => string,
 *   labelLang?: 'fr'|'nl',
 *   host: HTMLElement,                       // must be position: relative
 * }} args
 * @returns {{ max: number }}
 */
export function municipalityChoropleth(args) {
  const { data, counts, total, t, labelLang, host } = args;
  const lang = labelLang === 'nl' ? 'nl' : 'fr';
  let max = 0;
  for (const v of counts.values()) if (v > max) max = v;

  const root = svg('svg', {
    viewBox: data.viewBox,
    class: 'chart chart-choropleth',
    role: 'img',
    'aria-label': t('choropleth.aria_label'),
    preserveAspectRatio: 'xMidYMid meet',
  });

  // All paths live inside a single <g> so we can apply a single `transform`
  // attribute for pan/zoom. The transform stays on the SVG side; tooltip
  // and controls live in DOM and are positioned in pixel-space using
  // getBoundingClientRect, so they're immune to SVG repaint quirks.
  const stage = svg('g', { class: 'choropleth-stage' });
  root.appendChild(stage);

  const paths = [];
  for (const f of data.features) {
    const count = counts.get(f.cp) || 0;
    const path = svg('path', {
      d: f.d,
      fill: colorFor(count, max),
      stroke: 'var(--choropleth-stroke)',
      'stroke-width': 0.5,
      // non-scaling-stroke keeps borders at a constant on-screen thickness
      // when the user zooms (otherwise strokes scale with the transform and
      // become very fat at high zoom levels — and any sub-grid gap between
      // polygons gets visually amplified at the same time).
      'vector-effect': 'non-scaling-stroke',
      'data-cp': f.cp,
      'data-name': lang === 'nl' ? f.name_nl : f.name_fr,
      'data-count': count,
      class: 'choropleth-muni',
    });
    paths.push(path);
    stage.appendChild(path);
  }

  // ---- Pan / zoom state. We track viewBox-space transform: scale + tx/ty.
  const initialVB = data.viewBox.split(' ').map(Number);
  const [, , vbW, vbH] = initialVB;
  let scale = 1, tx = 0, ty = 0;
  // Forward declared; the actual element is built and assigned in the
  // controls block below, so we use `let` (not const) to allow late binding
  // without a TDZ trap if applyTransform somehow ran during setup.
  let zoomLabel = null;
  function applyTransform() {
    stage.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
    if (zoomLabel) zoomLabel.textContent = `${scale.toFixed(1)}×`;
    // Hide tooltip on every transform change — the highlighted polygon may
    // have moved off-screen, and recomputing its position would be racy.
    hideTip();
  }
  function clamp() {
    const minTx = vbW * (1 - scale);
    const minTy = vbH * (1 - scale);
    if (tx > 0) tx = 0; if (tx < minTx) tx = minTx;
    if (ty > 0) ty = 0; if (ty < minTy) ty = minTy;
  }
  function zoomAt(clientX, clientY, factor) {
    const ctm = stage.getScreenCTM();
    if (!ctm) return;
    const pt = root.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const newScale = Math.max(1, Math.min(20, scale * factor));
    if (newScale === scale) return;
    const anchorVbX = local.x * scale + tx;
    const anchorVbY = local.y * scale + ty;
    tx = anchorVbX - local.x * newScale;
    ty = anchorVbY - local.y * newScale;
    scale = newScale;
    clamp();
    applyTransform();
  }
  function zoomCenter(factor) {
    const r = root.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }
  function reset() {
    scale = 1; tx = 0; ty = 0; applyTransform();
  }

  // Wheel zoom anchored at cursor.
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });

  // Drag pan. Mouse + touch via Pointer Events.
  let dragging = false, lastX = 0, lastY = 0;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    root.setPointerCapture?.(e.pointerId);
    root.classList.add('is-dragging');
    hideTip();
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const ctm = root.getScreenCTM();
    if (!ctm) return;
    const dx = (e.clientX - lastX) / ctm.a;
    const dy = (e.clientY - lastY) / ctm.d;
    lastX = e.clientX; lastY = e.clientY;
    tx += dx; ty += dy;
    clamp(); applyTransform();
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    root.releasePointerCapture?.(e.pointerId);
    root.classList.remove('is-dragging');
  }
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('dblclick', reset);

  // ---- Tooltip: regular DOM div absolute-positioned inside the host.
  // Pixel positioning via getBoundingClientRect avoids the SVG repaint
  // bug where foreignObject box-shadows leave grey ghosts on the canvas.
  const tip = document.createElement('div');
  tip.className = 'choropleth-tip';
  tip.style.display = 'none';
  const tipName = document.createElement('div');
  tipName.className = 'choropleth-tip-name';
  const tipCount = document.createElement('div');
  tipCount.className = 'choropleth-tip-count';
  tip.appendChild(tipName);
  tip.appendChild(tipCount);

  let highlighted = null;
  function showTip(target) {
    if (dragging) return;
    const cp = target.getAttribute('data-cp');
    const name = target.getAttribute('data-name');
    const count = Number(target.getAttribute('data-count') || 0);
    const pct = total > 0 ? (count / total * 100) : 0;
    tipName.textContent = `${cp} · ${name}`;
    tipCount.textContent = count > 0
      ? `${count} ${t('choropleth.tip.clients')} · ${pct.toFixed(1)}%`
      : t('choropleth.tip.no_clients');
    // Position from the polygon's actual on-screen pixel rect. We center
    // horizontally on the polygon's mid-x and place the tooltip just above
    // the polygon's top edge; CSS `transform: translate(-50%, -100%)` does
    // the offset and the `translateY` keeps an 8px gap.
    const pr = target.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const cx = pr.left + pr.width / 2 - hr.left;
    let top = pr.top - hr.top - 8;
    let placement = 'top';
    // If there's no room above, flip below the polygon.
    if (top < 60) {
      top = pr.bottom - hr.top + 8;
      placement = 'bottom';
    }
    tip.style.left = `${Math.round(cx)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.dataset.placement = placement;
    tip.style.display = 'block';
    if (highlighted && highlighted !== target) highlighted.classList.remove('is-hover');
    target.classList.add('is-hover');
    highlighted = target;
  }
  function hideTip() {
    tip.style.display = 'none';
    if (highlighted) highlighted.classList.remove('is-hover');
    highlighted = null;
  }
  for (const p of paths) {
    p.addEventListener('mouseenter', (e) => showTip(e.currentTarget));
    p.addEventListener('focus', (e) => showTip(e.currentTarget));
    p.addEventListener('mouseleave', hideTip);
    p.addEventListener('blur', hideTip);
    p.setAttribute('tabindex', '-1');
  }
  root.addEventListener('mouseleave', hideTip);

  // ---- Zoom controls: floating top-right with +/-/reset and a level chip.
  const controls = document.createElement('div');
  controls.className = 'choropleth-controls';
  function btn(content, ariaKey, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choropleth-ctl';
    if (typeof content === 'string') {
      b.textContent = content;
    } else {
      b.appendChild(content);
    }
    b.setAttribute('aria-label', t(ariaKey) || ariaKey);
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return b;
  }
  controls.appendChild(btn('+', 'choropleth.zoom_in', () => zoomCenter(1.4)));
  controls.appendChild(btn('−', 'choropleth.zoom_out', () => zoomCenter(1 / 1.4)));
  controls.appendChild(btn(icon('house', { size: 14 }), 'choropleth.zoom_reset', reset));
  zoomLabel = document.createElement('span');
  zoomLabel.className = 'choropleth-zoom-label';
  zoomLabel.textContent = '1.0×';
  controls.appendChild(zoomLabel);

  // Mount everything into the host (caller has set position:relative on it).
  host.appendChild(root);
  host.appendChild(tip);
  host.appendChild(controls);

  return { max };
}

/**
 * Render a small continuous-scale legend (gradient bar + min/max labels and a
 * "no clients" swatch).
 */
export function choroplethLegend({ max, t }) {
  const wrap = document.createElement('div');
  wrap.className = 'choropleth-legend';

  // Top row: gradient bar only (no leading empty swatch — that was visually
  // ambiguous because the "1" label landed under the empty square instead of
  // the gradient's left edge). Min/max sit directly below the bar.
  const gradient = document.createElement('span');
  gradient.className = 'choropleth-legend-gradient';
  // Linear gradient driven by the same OKLCH-mixed end-stops we use for the
  // map fill. The map uses a sqrt curve, so we sample the gradient at 8
  // stops along the same curve so the legend visually matches the polygons.
  const stops = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const pct = (Math.pow(t, 0.5) * 100).toFixed(1);
    stops.push(`color-mix(in oklch, var(${LOW_VAR}), var(${HIGH_VAR}) ${pct}%) ${(t * 100).toFixed(0)}%`);
  }
  gradient.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
  wrap.appendChild(gradient);

  const labels = document.createElement('div');
  labels.className = 'choropleth-legend-labels';
  const left = document.createElement('span');
  left.textContent = max > 0 ? '1' : '0';
  const right = document.createElement('span');
  right.textContent = max > 0 ? String(max) : '';
  labels.appendChild(left);
  labels.appendChild(right);
  wrap.appendChild(labels);

  // Separate row for the categorical "no data" key. Decoupling it from the
  // continuous scale makes both rows trivially correct alignment-wise.
  const emptyRow = document.createElement('div');
  emptyRow.className = 'choropleth-legend-empty-row';
  const emptySwatch = document.createElement('span');
  emptySwatch.className = 'choropleth-legend-swatch is-empty';
  const emptyLabel = document.createElement('span');
  emptyLabel.className = 'choropleth-legend-empty-text';
  emptyLabel.textContent = t('choropleth.tip.no_clients');
  emptyRow.appendChild(emptySwatch);
  emptyRow.appendChild(emptyLabel);
  wrap.appendChild(emptyRow);

  return wrap;
}

function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    el.setAttribute(k, String(v));
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
