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
 * Build the choropleth SVG with pan/zoom interactions.
 *
 * @param {{
 *   data: { viewBox: string, features: Array<{cp,name_fr,name_nl,d}>, cpToCanonical: Map },
 *   counts: Map<string, number>,             // canonical-CP → client count
 *   total: number,
 *   t: (key: string) => string,
 *   labelLang?: 'fr'|'nl',
 * }} args
 * @returns {{ svg: SVGElement, max: number }}
 */
export function municipalityChoropleth(args) {
  const { data, counts, total, t, labelLang } = args;
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
  // attribute for pan/zoom — and so the tooltip's foreignObject stays in
  // unscaled SVG space (otherwise zooming would also scale the tooltip).
  const stage = svg('g', { class: 'choropleth-stage' });
  root.appendChild(stage);

  const paths = [];
  for (const f of data.features) {
    const count = counts.get(f.cp) || 0;
    const path = svg('path', {
      d: f.d,
      fill: colorFor(count, max),
      stroke: 'var(--choropleth-stroke)',
      'stroke-width': 0.4,
      'data-cp': f.cp,
      'data-name': lang === 'nl' ? f.name_nl : f.name_fr,
      'data-count': count,
      class: 'choropleth-muni',
    });
    paths.push(path);
    stage.appendChild(path);
  }

  // ---- Pan / zoom state. We track viewBox-space transform: scale + tx/ty.
  // The actual `transform` attribute is on the stage <g>, so the tooltip
  // (rendered later in unscaled space) keeps a consistent on-screen size.
  const initialVB = data.viewBox.split(' ').map(Number);
  const [, , vbW, vbH] = initialVB;
  let scale = 1, tx = 0, ty = 0;
  function applyTransform() {
    stage.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
  }
  function clamp() {
    // Keep the map within the viewBox: at scale=1 the offsets are 0; as we
    // zoom in, allow panning by up to (vb*(scale-1)) in each direction.
    const minTx = vbW * (1 - scale);
    const minTy = vbH * (1 - scale);
    if (tx > 0) tx = 0; if (tx < minTx) tx = minTx;
    if (ty > 0) ty = 0; if (ty < minTy) ty = minTy;
  }

  // Wheel: zoom anchored at the cursor. We convert the wheel event's client
  // coords into SVG viewBox coords via getScreenCTM(), then adjust tx/ty so
  // the point under the cursor stays put.
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const ctm = stage.getScreenCTM();
    if (!ctm) return;
    const pt = root.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());  // in stage's local (pre-transform) coords
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const newScale = Math.max(1, Math.min(20, scale * factor));
    if (newScale === scale) return;
    // Anchor: stage_x = (svg_x - tx) / scale  → must remain `local.x`.
    // After zoom: svg_x = local.x * newScale + new_tx → solve new_tx.
    // We computed local in pre-transform coords; the on-screen anchor in
    // viewBox space is (local.x * scale + tx). Keep that fixed.
    const anchorVbX = local.x * scale + tx;
    const anchorVbY = local.y * scale + ty;
    tx = anchorVbX - local.x * newScale;
    ty = anchorVbY - local.y * newScale;
    scale = newScale;
    clamp();
    applyTransform();
  }, { passive: false });

  // Drag pan. Mouse + touch via Pointer Events.
  let dragging = false, lastX = 0, lastY = 0;
  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    root.setPointerCapture?.(e.pointerId);
    root.classList.add('is-dragging');
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // Convert client-space delta into viewBox-space delta via CTM.
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

  // Double-click resets. Less surprising than ctrl/cmd-zero on a chart.
  root.addEventListener('dblclick', () => {
    scale = 1; tx = 0; ty = 0; applyTransform();
  });

  // ---- Tooltip overlay (CSP-safe: <foreignObject> + <div>, hidden via CSSOM).
  const tipFo = svg('foreignObject', {
    x: 0, y: 0, width: 240, height: 64,
    class: 'choropleth-tip-fo',
  });
  tipFo.style.overflow = 'visible';
  tipFo.style.pointerEvents = 'none';
  tipFo.style.display = 'none';

  const tip = document.createElement('div');
  tip.className = 'choropleth-tip';
  const tipName = document.createElement('div');
  tipName.className = 'choropleth-tip-name';
  const tipCount = document.createElement('div');
  tipCount.className = 'choropleth-tip-count';
  tip.appendChild(tipName);
  tip.appendChild(tipCount);
  tipFo.appendChild(tip);
  root.appendChild(tipFo);

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
    // Position tooltip near the path centroid in *post-transform* viewBox
    // space — getBBox() returns local (pre-transform) coords so we map them.
    const bb = target.getBBox();
    const cx = bb.x + bb.width / 2;
    const cy = bb.y;
    const vbX = cx * scale + tx;
    const vbY = cy * scale + ty;
    const tw = 240;
    const th = count > 0 ? 50 : 36;
    let tipX = vbX - tw / 2;
    let tipY = vbY - th - 6;
    if (tipX < 4) tipX = 4;
    if (tipX + tw > vbW - 4) tipX = vbW - tw - 4;
    if (tipY < 4) tipY = vbY + bb.height * scale + 6;
    if (tipY + th > vbH - 4) tipY = vbH - th - 4;
    tipFo.setAttribute('x', String(tipX));
    tipFo.setAttribute('y', String(tipY));
    tipFo.setAttribute('width', String(tw));
    tipFo.setAttribute('height', String(th));
    tipFo.style.display = 'block';
    if (highlighted && highlighted !== target) highlighted.classList.remove('is-hover');
    target.classList.add('is-hover');
    highlighted = target;
  }
  function hideTip() {
    tipFo.style.display = 'none';
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

  return { svg: root, max };
}

/**
 * Render a small continuous-scale legend (gradient bar + min/max labels and a
 * "no clients" swatch).
 */
export function choroplethLegend({ max, t }) {
  const wrap = document.createElement('div');
  wrap.className = 'choropleth-legend';

  const swatches = document.createElement('div');
  swatches.className = 'choropleth-legend-swatches';
  const empty = document.createElement('span');
  empty.className = 'choropleth-legend-swatch is-empty';
  empty.title = t('choropleth.tip.no_clients');
  swatches.appendChild(empty);
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
  swatches.appendChild(gradient);
  wrap.appendChild(swatches);

  const labels = document.createElement('div');
  labels.className = 'choropleth-legend-labels';
  const left = document.createElement('span');
  left.textContent = max > 0 ? '1' : '0';
  const right = document.createElement('span');
  right.textContent = max > 0 ? String(max) : '';
  labels.appendChild(left);
  labels.appendChild(right);
  wrap.appendChild(labels);
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
