// Lightweight inline-SVG chart primitives. No external deps, no innerHTML.
// Every element is created via createElementNS for CSP safety.
//
// Chart palette is driven by CSS custom properties so they track light/dark.

const SVG_NS = 'http://www.w3.org/2000/svg';

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

function cssVar(token, fallback) {
  const v = token.startsWith('--') ? `var(${token})` : token;
  return fallback ? `${v}` : v;
}

// ---------------------------------------------------------------------------
// Pie / donut chart
// ---------------------------------------------------------------------------

export function pieChart(segments, opts = {}) {
  const size = opts.size ?? 180;
  const stroke = opts.stroke ?? 36;        // donut thickness
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + (x.value || 0), 0) || 1;

  const root = svg('svg', {
    viewBox: `0 0 ${size} ${size}`,
    width: size,
    height: size,
    class: 'chart chart-pie',
    role: 'img',
    'aria-label': opts.label || 'pie chart',
  });

  // Background ring for visual weight.
  root.appendChild(svg('circle', {
    cx, cy, r,
    fill: 'none',
    stroke: 'var(--fill)',
    'stroke-width': stroke,
  }));

  let offset = 0;
  for (const seg of segments) {
    const len = (seg.value / total) * C;
    root.appendChild(svg('circle', {
      cx, cy, r,
      fill: 'none',
      stroke: cssVar(seg.color || '--accent'),
      'stroke-width': stroke,
      'stroke-dasharray': `${len} ${C - len}`,
      'stroke-dashoffset': -offset,
      transform: `rotate(-90 ${cx} ${cy})`,
      class: 'chart-pie-slice',
      'data-sync-key': seg.key || null,
    }));
    offset += len;
  }

  return root;
}

export function pieLegend(segments, formatter) {
  const fmt = formatter || ((v) => String(v));
  return segments.map((seg) => ({
    dot: svg('span', {}), // placeholder; caller builds DOM
    label: seg.label,
    value: fmt(seg.value),
    color: seg.color,
  }));
}

// ---------------------------------------------------------------------------
// Horizontal bar chart
// ---------------------------------------------------------------------------
//
// items: [{label, value, color?}]
// Bars share a common scale so widths are comparable.

export function hBarChart(items, opts = {}) {
  const width = opts.width ?? 320;
  const rowHeight = opts.rowHeight ?? 22;
  const gap = opts.gap ?? 4;
  const labelWidth = opts.labelWidth ?? 110;
  const valueWidth = opts.valueWidth ?? 48;
  const max = (opts.max ?? items.reduce((m, x) => Math.max(m, x.value || 0), 0)) || 1;
  const barTrack = Math.max(20, width - labelWidth - valueWidth - 16);
  const height = items.length * rowHeight + (items.length - 1) * gap;

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    class: 'chart chart-hbar',
    role: 'img',
    overflow: 'visible',
    'aria-label': opts.label || 'bar chart',
  });

  items.forEach((it, i) => {
    const y = i * (rowHeight + gap);
    const bw = Math.max(2, (it.value / max) * barTrack);

    // Group the row so hover/focus/sync can target a single element, and
    // so downstream CSS can highlight labels + bars together.
    const g = svg('g', {
      class: 'chart-row',
      'data-sync-key': it.key || null,
    });

    g.appendChild(svg('text', {
      x: labelWidth - 6,
      y: y + rowHeight / 2 + 4,
      'text-anchor': 'end',
      class: 'chart-label',
    }, it.label));

    // Track
    g.appendChild(svg('rect', {
      x: labelWidth,
      y: y + 4,
      width: barTrack,
      height: rowHeight - 8,
      rx: 3,
      fill: 'var(--fill)',
    }));
    // Fill
    g.appendChild(svg('rect', {
      x: labelWidth,
      y: y + 4,
      width: bw,
      height: rowHeight - 8,
      rx: 3,
      fill: cssVar(it.color || opts.color || '--accent'),
      class: 'chart-bar-fill',
    }));

    g.appendChild(svg('text', {
      x: labelWidth + barTrack + 6,
      y: y + rowHeight / 2 + 4,
      class: 'chart-value',
    }, it.valueLabel ?? String(it.value)));

    // Full-row hit area for hover sync.
    g.appendChild(svg('rect', {
      x: 0, y,
      width,
      height: rowHeight,
      fill: 'transparent',
      class: 'chart-hit',
    }));

    root.appendChild(g);
  });

  return root;
}

// ---------------------------------------------------------------------------
// Vertical bar chart
// ---------------------------------------------------------------------------

export function vBarChart(items, opts = {}) {
  const width = opts.width ?? 320;
  const height = opts.height ?? 160;
  const padBottom = opts.padBottom ?? 28;
  const padTop = opts.padTop ?? 6;
  const max = (opts.max ?? items.reduce((m, x) => Math.max(m, x.value || 0), 0)) || 1;
  const n = items.length || 1;
  const gap = 6;
  const barW = Math.max(6, (width - gap * (n + 1)) / n);
  const chartH = height - padBottom - padTop;

  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    class: 'chart chart-vbar',
    role: 'img',
    overflow: 'visible',
    'aria-label': opts.label || 'bar chart',
  });

  // Baseline
  root.appendChild(svg('line', {
    x1: 0, y1: height - padBottom,
    x2: width, y2: height - padBottom,
    stroke: 'var(--separator)',
    'stroke-width': 1,
  }));

  items.forEach((it, i) => {
    const x = gap + i * (barW + gap);
    const h = Math.max(1, (it.value / max) * chartH);
    const y = height - padBottom - h;

    const g = svg('g', {
      class: 'chart-row',
      'data-sync-key': it.key || null,
    });

    g.appendChild(svg('rect', {
      x, y,
      width: barW,
      height: h,
      rx: 3,
      fill: cssVar(it.color || opts.color || '--accent'),
      class: 'chart-bar-fill',
    }));

    if (it.valueLabel != null) {
      g.appendChild(svg('text', {
        x: x + barW / 2,
        y: y - 4,
        'text-anchor': 'middle',
        class: 'chart-value',
      }, it.valueLabel));
    }

    g.appendChild(svg('text', {
      x: x + barW / 2,
      y: height - padBottom + 14,
      'text-anchor': 'middle',
      class: 'chart-label',
    }, it.label));

    // Full-column hit area for hover sync.
    g.appendChild(svg('rect', {
      x: x - gap / 2,
      y: padTop,
      width: barW + gap,
      height: height - padTop,
      fill: 'transparent',
      class: 'chart-hit',
    }));

    root.appendChild(g);
  });

  return root;
}

// ---------------------------------------------------------------------------
// Time-series line chart
// ---------------------------------------------------------------------------
//
// points: [{ date: Date|string (YYYY-MM-DD), value: number, label?: string }]
// X positions reflect real calendar spacing between dates — a snapshot taken
// two months after another sits at twice the distance of a one-month gap.
// With a single point, falls back to centered placement.

export function lineChart(points, opts = {}) {
  const width = opts.width ?? 420;
  const height = opts.height ?? 180;
  // padLeft gives the y-axis room for the widest tick label (currency values
  // like "€1.234.567" are ~70px at 11px font). padTop leaves headroom above
  // the top dot so the value label (sits at y - 8) doesn't clip. Callers can
  // still override.
  const padLeft = opts.padLeft ?? 64;
  const padRight = opts.padRight ?? 20;
  const padTop = opts.padTop ?? 24;
  const padBottom = opts.padBottom ?? 30;
  const color = opts.color || '--accent';
  const valueFmt = opts.valueFmt || ((v) => String(v));
  const dateFmt = opts.dateFmt || defaultDateFmt;
  const vsPrevLabel = opts.vsPrevLabel || 'vs previous';
  const vsFirstLabel = opts.vsFirstLabel || 'since start';
  const noDataLabel = opts.noDataLabel || 'no data';

  // overflow: visible lets value labels near the edges (leftmost/rightmost
  // dots or the topmost dot) paint outside the viewBox instead of being
  // chopped by the SVG viewport.
  const root = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    class: 'chart chart-line',
    role: 'img',
    overflow: 'visible',
    'aria-label': opts.label || 'line chart',
  });

  if (!points || points.length === 0) return root;

  // Normalize dates → timestamps. A zero value is treated as "no data" —
  // it renders as a hollow dot on the baseline and breaks the line so the
  // series isn't artificially pulled down to zero between real snapshots.
  const pts = points.map((p) => {
    const d = p.date instanceof Date ? p.date : new Date(p.date);
    const num = Number(p.value);
    const v = Number.isFinite(num) ? num : 0;
    return { t: d.getTime(), v, raw: p, isZero: v === 0 };
  }).filter((p) => Number.isFinite(p.t));

  if (pts.length === 0) return root;
  pts.sort((a, b) => a.t - b.t);

  // Relative evolution: each non-zero point gets a % delta vs the previous
  // non-zero point and vs the first non-zero point. Zero points skip this.
  let firstAnchor = null;
  let prevAnchor = null;
  for (const p of pts) {
    if (p.isZero) {
      p.deltaPrev = null;
      p.deltaFirst = null;
      continue;
    }
    p.deltaPrev = (prevAnchor != null && prevAnchor !== 0)
      ? ((p.v - prevAnchor) / prevAnchor) * 100 : null;
    p.deltaFirst = (firstAnchor != null && firstAnchor !== 0)
      ? ((p.v - firstAnchor) / firstAnchor) * 100 : null;
    if (firstAnchor == null) firstAnchor = p.v;
    prevAnchor = p.v;
  }

  const tMin = pts[0].t;
  const tMax = pts[pts.length - 1].t;
  const tSpan = tMax - tMin || 1;

  // Y scale ignores zero "no data" points so a single missing snapshot
  // doesn't collapse the range.
  const realVals = pts.filter((p) => !p.isZero).map((p) => p.v);
  const scaleVals = realVals.length ? realVals : [0, 1];
  const vMin = opts.yMin != null ? opts.yMin : Math.min(0, Math.min(...scaleVals));
  const vMaxRaw = Math.max(...scaleVals);
  const vMax = opts.yMax != null ? opts.yMax : (vMaxRaw === vMin ? vMin + 1 : vMaxRaw);
  const vSpan = vMax - vMin || 1;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const xAt = (t) => pts.length === 1
    ? padLeft + plotW / 2
    : padLeft + ((t - tMin) / tSpan) * plotW;
  const yAt = (v) => padTop + plotH - ((v - vMin) / vSpan) * plotH;

  // Baseline
  root.appendChild(svg('line', {
    x1: padLeft, y1: padTop + plotH,
    x2: padLeft + plotW, y2: padTop + plotH,
    stroke: 'var(--separator)', 'stroke-width': 1,
  }));

  // Y-axis ticks (min, max)
  root.appendChild(svg('text', {
    x: padLeft - 6, y: yAt(vMax) + 4,
    'text-anchor': 'end', class: 'chart-label',
  }, valueFmt(vMax)));
  root.appendChild(svg('text', {
    x: padLeft - 6, y: yAt(vMin) + 4,
    'text-anchor': 'end', class: 'chart-label',
  }, valueFmt(vMin)));

  // Horizontal grid line at vMax
  root.appendChild(svg('line', {
    x1: padLeft, y1: yAt(vMax),
    x2: padLeft + plotW, y2: yAt(vMax),
    stroke: 'var(--separator)', 'stroke-width': 0.5,
    'stroke-dasharray': '2 3',
  }));

  // Line path. Zero ("no data") points break the line into separate segments
  // so a missing snapshot shows a visible gap instead of a misleading V-shape.
  if (pts.length > 1) {
    const segments = [];
    let seg = [];
    for (const p of pts) {
      if (p.isZero) {
        if (seg.length > 1) segments.push(seg);
        seg = [];
      } else {
        seg.push(p);
      }
    }
    if (seg.length > 1) segments.push(seg);

    for (const s of segments) {
      const d = s.map((p, i) =>
        `${i === 0 ? 'M' : 'L'}${xAt(p.t).toFixed(1)},${yAt(p.v).toFixed(1)}`
      ).join(' ');
      root.appendChild(svg('path', {
        d, fill: 'none',
        stroke: cssVar(color), 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }));
    }
  }

  // Calendar tick marks on the x-axis. Small tick at the 1st of every month,
  // taller tick + year label at every January 1st. Ticks only render inside
  // the plotted time span so they never extend past the axis.
  const axisY = padTop + plotH;
  const dMin = new Date(tMin);
  // First 1st-of-month at or after tMin.
  let monthCursor = new Date(dMin.getFullYear(), dMin.getMonth(), 1);
  if (monthCursor.getTime() < tMin) {
    monthCursor = new Date(dMin.getFullYear(), dMin.getMonth() + 1, 1);
  }
  // Safety cap: at most ~20 years of monthly ticks.
  for (let i = 0; i < 240; i++) {
    const mt = monthCursor.getTime();
    if (mt > tMax) break;
    const x = xAt(mt);
    const isYearStart = monthCursor.getMonth() === 0;
    const tickLen = isYearStart ? 8 : 4;
    root.appendChild(svg('line', {
      x1: x, y1: axisY,
      x2: x, y2: axisY + tickLen,
      stroke: 'var(--separator)',
      'stroke-width': isYearStart ? 1.25 : 0.75,
    }));
    if (isYearStart) {
      root.appendChild(svg('text', {
        x, y: axisY + 20,
        'text-anchor': 'middle', class: 'chart-label',
      }, String(monthCursor.getFullYear())));
    }
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
  }

  // Reusable tooltip. Built once, repositioned on hover/click. Rendered via
  // foreignObject so we can style it with regular CSS, and anchored at the
  // end of the SVG tree so it paints above dots and lines.
  const tipW = 180;
  const tipH = 96;
  const tipFo = svg('foreignObject', {
    x: 0, y: 0, width: tipW, height: tipH,
    class: 'chart-tip-fo',
    style: 'overflow: visible; pointer-events: none; display: none;',
  });
  const tipEl = document.createElement('div');
  tipEl.className = 'chart-tip';
  tipFo.appendChild(tipEl);

  function showTip(p, x, y) {
    renderTooltip(tipEl, p, { valueFmt, dateFmt, vsPrevLabel, vsFirstLabel, noDataLabel });
    let tx = x - tipW / 2;
    let ty = y - tipH - 14;
    if (tx < 2) tx = 2;
    if (tx + tipW > width - 2) tx = width - tipW - 2;
    if (ty < 2) ty = y + 14;
    tipFo.setAttribute('x', tx);
    tipFo.setAttribute('y', ty);
    tipFo.style.display = '';
  }
  function hideTip() {
    tipFo.style.display = 'none';
  }

  // Data-point dots + value labels + invisible hit-area for easy hover/tap.
  pts.forEach((p) => {
    const x = xAt(p.t);
    const y = p.isZero ? yAt(0) : yAt(p.v);

    if (p.isZero) {
      // Hollow, dashed dot on the baseline to flag "no data".
      root.appendChild(svg('circle', {
        cx: x, cy: y, r: 4,
        fill: 'var(--bg)',
        stroke: cssVar(color),
        'stroke-width': 1.5,
        'stroke-dasharray': '2 2',
      }));
    } else {
      root.appendChild(svg('circle', {
        cx: x, cy: y, r: 3.5,
        fill: cssVar(color), stroke: 'var(--bg)', 'stroke-width': 1.5,
      }));
      root.appendChild(svg('text', {
        x, y: y - 8,
        'text-anchor': 'middle', class: 'chart-value',
      }, valueFmt(p.v)));
    }

    const hit = svg('circle', {
      cx: x, cy: y, r: 14,
      fill: 'transparent',
      class: 'chart-hit',
    });
    hit.addEventListener('pointerenter', () => showTip(p, x, y));
    hit.addEventListener('pointerleave', hideTip);
    hit.addEventListener('click', (e) => { e.stopPropagation(); showTip(p, x, y); });
    root.appendChild(hit);
  });

  root.appendChild(tipFo);
  // Clicking the chart background dismisses a sticky tooltip.
  root.addEventListener('click', hideTip);

  return root;
}

// ---------------------------------------------------------------------------
// Line-chart tooltip helpers
// ---------------------------------------------------------------------------

function renderTooltip(tipEl, p, opts) {
  while (tipEl.firstChild) tipEl.removeChild(tipEl.firstChild);

  const dateRow = document.createElement('div');
  dateRow.className = 'chart-tip-date';
  dateRow.textContent = opts.dateFmt(new Date(p.t));
  tipEl.appendChild(dateRow);

  const valueRow = document.createElement('div');
  valueRow.className = 'chart-tip-value';
  if (p.isZero) {
    valueRow.textContent = '— ' + opts.noDataLabel;
    valueRow.classList.add('no-data');
  } else {
    valueRow.textContent = opts.valueFmt(p.v);
  }
  tipEl.appendChild(valueRow);

  if (!p.isZero) {
    if (p.deltaPrev != null) {
      tipEl.appendChild(deltaRow(opts.vsPrevLabel, p.deltaPrev));
    }
    if (p.deltaFirst != null) {
      tipEl.appendChild(deltaRow(opts.vsFirstLabel, p.deltaFirst));
    }
  }
}

function deltaRow(label, pct) {
  const row = document.createElement('div');
  row.className = 'chart-tip-delta ' + deltaTone(pct);
  const name = document.createElement('span');
  name.className = 'chart-tip-delta-label';
  name.textContent = label;
  const val = document.createElement('span');
  val.className = 'chart-tip-delta-value';
  val.textContent = formatSignedPct(pct);
  row.appendChild(name);
  row.appendChild(val);
  return row;
}

function deltaTone(pct) {
  if (pct > 0.05) return 'up';
  if (pct < -0.05) return 'down';
  return 'neutral';
}

function formatSignedPct(pct) {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)} %`;
}

function defaultDateFmt(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
