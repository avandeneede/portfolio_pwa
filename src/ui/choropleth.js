// Inline-SVG choropleth of Belgian municipalities. No external library, no
// tile server, no innerHTML — every node is created via createElementNS for
// CSP-safety (the same pattern as charts.js).
//
// The data file `data/be_municipalities.json` is precached by the SW; we
// fetch it lazily on first render and memoise the result so subsequent
// dashboards share the parsed file.
//
// Coloring: a 5-step quantile-ish scale anchored on the number of clients
// per municipality. Buckets are computed from the *non-empty* count
// distribution so a long tail of single-client communes doesn't drown out
// the map. Empty munis render as a neutral gray fill.
//
// Hover tooltip: SVG <foreignObject> with a styled <div> (same CSP-safe
// trick as the line-chart tooltip in charts.js — set `display: none` via
// CSSOM after creation, not via a string `style` attribute, otherwise
// `style-src 'self'` drops it and the empty box flashes).

const SVG_NS = 'http://www.w3.org/2000/svg';
const DATA_PATH = './data/be_municipalities.json';

// Five sequential blues from the existing chart palette. Index 0 = lightest
// for the smallest non-empty bucket, index 4 = deepest blue for the top.
const SCALE_VARS = [
  '--choropleth-1',
  '--choropleth-2',
  '--choropleth-3',
  '--choropleth-4',
  '--choropleth-5',
];
const EMPTY_VAR = '--choropleth-empty';

let _cache = null;        // resolved data
let _inflight = null;     // in-flight fetch promise (dedupe concurrent calls)

export async function loadMunicipalities() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = fetch(DATA_PATH, { cache: 'force-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`muni fetch ${r.status}`);
      return r.json();
    })
    .then((data) => {
      // Build name → NIS index for fast localite matching. We index both
      // FR and NL canonical names since brokers export either depending on
      // the region.
      const byName = new Map();
      for (const f of data.features) {
        const fr = normaliseName(f.name_fr);
        const nl = normaliseName(f.name_nl);
        if (fr) byName.set(fr, f.nis);
        if (nl && !byName.has(nl)) byName.set(nl, f.nis);
      }
      _cache = { ...data, byName };
      return _cache;
    })
    .catch((err) => { _inflight = null; throw err; });
  return _inflight;
}

// Normalise a commune name for lookup: lowercase, strip diacritics, strip
// hyphens/apostrophes/spaces. Keeps the key tolerant to broker-export quirks
// ("Bruxelles" vs "Bruxelles-Capitale", "Sint-Truiden" vs "Sint Truiden",
// "L'Écluse" vs "L'écluse").
function normaliseName(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s'\-]+/g, '');
}

// Compute 5 quantile-ish buckets from the non-empty count distribution.
// Pure quantiles can collapse when most municipalities have 1 client; we
// special-case so the smallest bucket is always [1, q1] inclusive.
function bucketize(counts) {
  const arr = [...counts.values()].filter((v) => v > 0).sort((a, b) => a - b);
  if (arr.length === 0) return { thresholds: [], max: 0 };
  const max = arr[arr.length - 1];
  if (arr.length < 5) {
    return { thresholds: arr, max };
  }
  const thresholds = [];
  for (let i = 1; i <= 4; i++) {
    thresholds.push(arr[Math.floor(arr.length * i / 5)]);
  }
  thresholds.push(max);
  return { thresholds, max };
}

function bucketIndex(count, thresholds) {
  if (count <= 0) return -1;
  for (let i = 0; i < thresholds.length; i++) {
    if (count <= thresholds[i]) return i;
  }
  return thresholds.length - 1;
}

/**
 * Build the choropleth SVG.
 *
 * @param {{
 *   data: { viewBox: string, features: Array<{nis,name_fr,name_nl,d}>, byName: Map },
 *   counts: Map<string, number>,             // NIS → client count
 *   localiteToNis?: Map<string, string>,     // optional: pre-resolved CP-localite → NIS map
 *   total: number,
 *   t: (key: string) => string,
 *   labelLang?: 'fr'|'nl',
 * }} args
 */
export function municipalityChoropleth(args) {
  const { data, counts, total, t, labelLang } = args;
  const lang = labelLang === 'nl' ? 'nl' : 'fr';
  const { thresholds, max } = bucketize(counts);

  const root = svg('svg', {
    viewBox: data.viewBox,
    class: 'chart chart-choropleth',
    role: 'img',
    'aria-label': t('choropleth.aria_label'),
    preserveAspectRatio: 'xMidYMid meet',
  });

  // Background subtle wash so empty (no clients) communes still read as
  // map shapes, not as transparent holes.
  const paths = [];
  for (const f of data.features) {
    const count = counts.get(f.nis) || 0;
    const bIdx = bucketIndex(count, thresholds);
    const fillVar = bIdx < 0 ? EMPTY_VAR : SCALE_VARS[bIdx];
    const path = svg('path', {
      d: f.d,
      fill: `var(${fillVar})`,
      stroke: 'var(--choropleth-stroke)',
      'stroke-width': 0.4,
      'data-nis': f.nis,
      'data-name': lang === 'nl' ? f.name_nl : f.name_fr,
      'data-count': count,
      class: 'choropleth-muni',
    });
    paths.push(path);
    root.appendChild(path);
  }

  // Tooltip overlay: same SVG <foreignObject>+<div> pattern as the line
  // chart. Hidden via CSSOM (CSP-safe), shown on path hover/focus.
  const tipFo = svg('foreignObject', {
    x: 0, y: 0, width: 220, height: 60,
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
    const nis = target.getAttribute('data-nis');
    const name = target.getAttribute('data-name');
    const count = Number(target.getAttribute('data-count') || 0);
    const pct = total > 0 ? (count / total * 100) : 0;
    tipName.textContent = name;
    tipCount.textContent = count > 0
      ? `${count} ${t('choropleth.tip.clients')} · ${pct.toFixed(1)}%`
      : t('choropleth.tip.no_clients');
    // Position tooltip near the path centroid (using getBBox in SVG units).
    const bb = target.getBBox();
    const tw = 220;
    const th = count > 0 ? 50 : 36;
    let tx = bb.x + bb.width / 2 - tw / 2;
    let ty = bb.y - th - 4;
    // Clamp inside the viewBox so the tooltip never falls outside the map.
    const [, , vw, vh] = data.viewBox.split(' ').map(Number);
    if (tx < 4) tx = 4;
    if (tx + tw > vw - 4) tx = vw - tw - 4;
    if (ty < 4) ty = bb.y + bb.height + 4;
    if (ty + th > vh - 4) ty = vh - th - 4;
    tipFo.setAttribute('x', String(tx));
    tipFo.setAttribute('y', String(ty));
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
    // Make paths focusable for keyboard users.
    p.setAttribute('tabindex', '-1');
  }
  root.addEventListener('mouseleave', hideTip);

  return { svg: root, max, thresholds };
}

/**
 * Resolve broker geographic-profile rows (CP, localite, count) into a
 * Map<NIS, count> by name-matching against the municipality index.
 *
 * Returns { counts, mapped, total, unmapped: [{cp, localite, count}, ...] }.
 *
 * @param {Array<{code_postal:string, localite:string, count:number}>} rows
 * @param {Map<string,string>} byName  normalised name → NIS index
 */
export function resolveCountsByNis(rows, byName) {
  const counts = new Map();
  const unmapped = [];
  let mapped = 0, total = 0;
  for (const r of rows) {
    const c = r.count || 0;
    total += c;
    const k = normaliseName(r.localite);
    const nis = k ? byName.get(k) : undefined;
    if (nis) {
      counts.set(nis, (counts.get(nis) || 0) + c);
      mapped += c;
    } else {
      unmapped.push({ code_postal: r.code_postal, localite: r.localite, count: c });
    }
  }
  return { counts, mapped, total, unmapped };
}

/**
 * Render a small colour-scale legend (5 swatches + "no clients" + min/max
 * range labels) for the choropleth.
 */
export function choroplethLegend({ thresholds, max, t }) {
  const wrap = document.createElement('div');
  wrap.className = 'choropleth-legend';
  const swatches = document.createElement('div');
  swatches.className = 'choropleth-legend-swatches';

  // "No clients" swatch first.
  const empty = document.createElement('span');
  empty.className = 'choropleth-legend-swatch is-empty';
  empty.title = t('choropleth.tip.no_clients');
  swatches.appendChild(empty);

  for (const v of SCALE_VARS) {
    const sw = document.createElement('span');
    sw.className = 'choropleth-legend-swatch';
    sw.style.background = `var(${v})`;
    swatches.appendChild(sw);
  }
  wrap.appendChild(swatches);
  const labels = document.createElement('div');
  labels.className = 'choropleth-legend-labels';
  const left = document.createElement('span');
  left.textContent = t('choropleth.legend.fewer');
  const right = document.createElement('span');
  right.textContent = max > 0 ? `${t('choropleth.legend.more')} (max ${max})` : t('choropleth.legend.more');
  labels.appendChild(left);
  labels.appendChild(right);
  wrap.appendChild(labels);
  return wrap;
}

// Local SVG helper, isolated so this module doesn't need to import from
// charts.js (keeps the choropleth bundle independent for lazy loading).
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
