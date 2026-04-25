// Preprocess the Statbel statistical-sectors GeoJSON into a compact SVG-ready
// municipalities file for the dashboard choropleth.
//
// Source (~212MB, EPSG:3812 Belgian Lambert):
//   sh_statbel_statistical_sectors_3812_20230101.geojson
//
// The source has ~19,800 statistical sectors; we want ~581 dissolved
// municipalities. Strategy:
//
//   1. Read every sector, normalise its outer ring to integer-metre
//      precision (the source already shares vertices on adjacent sectors
//      bit-for-bit, so integer rounding is just safety against IEEE noise).
//   2. Per municipality (cd_munty_refnis), tally undirected edges across all
//      its sectors. Edges shared by exactly 2 sectors of the same muni are
//      *interior* — drop them. Edges with odd multiplicity (almost always 1)
//      are *boundary* — keep them.
//   3. Stitch boundary edges into closed rings by following point→edge
//      adjacency. Each connected component becomes one ring (outer or hole).
//   4. Simplify each dissolved ring with decimation + min-distance.
//   5. Linearly map EPSG:3812 metres → SVG viewBox (Y-flipped).
//
// Run:
//   node tools/build-municipalities.mjs <path-to-source.geojson>
//
// Output:
//   data/be_municipalities.json
//   {
//     viewBox: "0 0 1000 H",
//     features: [
//       { nis: "11001", name_fr: "Aartselaar", name_nl: "Aartselaar", d: "M ... Z M ... Z" },
//       ...
//     ]
//   }

import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_PATH = join(REPO_ROOT, 'data', 'be_municipalities.json');

// Decimation on the *dissolved* boundary (much sparser than per-sector).
const DECIMATE = 8;
// Min distance between kept vertices on the dissolved boundary, metres.
// At 1000px/270km ≈ 3.7px/km, anything closer than 700m is sub-pixel.
const MIN_DIST_M = 700;
// Drop dissolved rings smaller than this — slivers from imperfect topology.
const MIN_RING_BBOX_M2 = 500_000;
const MIN_RING_POINTS = 4;

function dec2(n) { return Math.round(n * 100) / 100; }

// Canonical edge key — endpoints sorted, integer metres, joined.
function edgeKey(ax, ay, bx, by) {
  if (ax < bx || (ax === bx && ay < by)) return `${ax},${ay}|${bx},${by}`;
  return `${bx},${by}|${ax},${ay}`;
}
function pointKey(x, y) { return `${x},${y}`; }
function parsePoint(k) { const [x, y] = k.split(',').map(Number); return [x, y]; }

function simplifyRing(ring) {
  const out = [];
  let lastX = NaN, lastY = NaN;
  for (let i = 0; i < ring.length; i++) {
    const isLast = i === ring.length - 1;
    if (i !== 0 && !isLast && i % DECIMATE !== 0) continue;
    const [x, y] = ring[i];
    if (!isLast && !Number.isNaN(lastX)) {
      const dx = x - lastX, dy = y - lastY;
      if (dx * dx + dy * dy < MIN_DIST_M * MIN_DIST_M) continue;
    }
    out.push([x, y]);
    lastX = x; lastY = y;
  }
  return out;
}

// Stitch boundary edges into closed rings.
function stitchRings(edges) {
  // Build adjacency: point → set of partner points (still in pool).
  const adj = new Map();
  const addAdj = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  };
  for (const k of edges) {
    const [a, b] = k.split('|');
    addAdj(a, b);
    addAdj(b, a);
  }
  const rings = [];
  while (adj.size > 0) {
    // Pick any starting point with edges left.
    let start = null;
    for (const [p, neighbours] of adj) {
      if (neighbours.length > 0) { start = p; break; }
    }
    if (!start) break;
    const ring = [];
    let cur = start;
    let prev = null;
    let safety = 0;
    while (safety++ < 100_000) {
      ring.push(parsePoint(cur));
      const neighbours = adj.get(cur) || [];
      if (neighbours.length === 0) break;
      // Prefer the neighbour that isn't `prev` so we walk forward; if only
      // prev is available, the ring closes.
      let nextIdx = -1;
      for (let i = 0; i < neighbours.length; i++) {
        if (neighbours[i] !== prev) { nextIdx = i; break; }
      }
      if (nextIdx === -1) nextIdx = 0;
      const next = neighbours[nextIdx];
      // Consume the undirected edge from both ends.
      neighbours.splice(nextIdx, 1);
      if (neighbours.length === 0) adj.delete(cur);
      const back = adj.get(next);
      if (back) {
        const bi = back.indexOf(cur);
        if (bi >= 0) back.splice(bi, 1);
        if (back.length === 0) adj.delete(next);
      }
      if (next === start) break;
      prev = cur;
      cur = next;
    }
    if (ring.length >= MIN_RING_POINTS) rings.push(ring);
  }
  return rings;
}

async function main() {
  const src = process.argv[2];
  if (!src) {
    console.error('usage: node tools/build-municipalities.mjs <source.geojson>');
    process.exit(1);
  }
  console.log(`reading ${src}...`);

  // Per-NIS edge tally: NIS -> Map(edgeKey -> count).
  const niMeta = new Map();         // NIS -> { name_fr, name_nl }
  const edgeTally = new Map();      // NIS -> Map(edgeKey -> count)
  const global = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let featureCount = 0;

  const stream = createReadStream(src);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const rawLine of rl) {
    let line = rawLine.trim();
    if (!line.startsWith('{ "type": "Feature"')) continue;
    if (line.endsWith(',')) line = line.slice(0, -1);
    let feat;
    try { feat = JSON.parse(line); } catch { continue; }
    const props = feat.properties || {};
    const nis = props.cd_munty_refnis;
    if (!nis) continue;
    const geom = feat.geometry;
    if (!geom) continue;
    let polys;
    if (geom.type === 'Polygon') polys = [geom.coordinates];
    else if (geom.type === 'MultiPolygon') polys = geom.coordinates;
    else continue;

    if (!niMeta.has(nis)) {
      niMeta.set(nis, {
        name_fr: props.tx_munty_descr_fr || nis,
        name_nl: props.tx_munty_descr_nl || nis,
      });
    }
    let tally = edgeTally.get(nis);
    if (!tally) { tally = new Map(); edgeTally.set(nis, tally); }

    for (const poly of polys) {
      const outer = poly[0];
      if (!outer || outer.length < 3) continue;
      // Round to integer metres so adjacent sectors hash to identical keys.
      let prevX = null, prevY = null;
      for (let i = 0; i < outer.length; i++) {
        const x = Math.round(outer[i][0]);
        const y = Math.round(outer[i][1]);
        if (x < global.minX) global.minX = x;
        if (y < global.minY) global.minY = y;
        if (x > global.maxX) global.maxX = x;
        if (y > global.maxY) global.maxY = y;
        if (prevX !== null) {
          if (x !== prevX || y !== prevY) {
            const k = edgeKey(prevX, prevY, x, y);
            tally.set(k, (tally.get(k) || 0) + 1);
          }
        }
        prevX = x; prevY = y;
      }
    }
    featureCount++;
    if (featureCount % 5000 === 0) {
      console.log(`  ...${featureCount} sectors, ${niMeta.size} municipalities`);
    }
  }

  console.log(`parsed ${featureCount} sectors → ${niMeta.size} municipalities`);
  console.log(`bbox (3812): X=[${global.minX}..${global.maxX}] Y=[${global.minY}..${global.maxY}]`);

  // For each NIS, keep boundary edges (odd multiplicity — almost always 1),
  // stitch into rings, simplify, store.
  const dissolved = new Map(); // NIS -> [ring,...]
  let totalBoundary = 0, totalInterior = 0;
  for (const [nis, tally] of edgeTally) {
    const boundary = [];
    for (const [k, count] of tally) {
      if (count % 2 === 1) { boundary.push(k); totalBoundary++; }
      else { totalInterior++; }
    }
    const rings = stitchRings(boundary);
    dissolved.set(nis, rings);
  }
  console.log(`edges: ${totalBoundary} boundary, ${totalInterior} interior dropped`);

  // Map EPSG:3812 metres → SVG viewBox. Y-flip (3812 north-positive, SVG down).
  const VW = 1000;
  const spanX = global.maxX - global.minX;
  const spanY = global.maxY - global.minY;
  const VH = Math.round(VW * (spanY / spanX));
  const scale = VW / spanX;

  const features = [];
  let droppedTiny = 0;
  for (const [nis, meta] of [...niMeta.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rings = dissolved.get(nis) || [];
    const subpaths = [];
    for (const ring of rings) {
      // Drop slivers below threshold.
      let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
      for (const [x, y] of ring) {
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (y < mny) mny = y; if (y > mxy) mxy = y;
      }
      if ((mxx - mnx) * (mxy - mny) < MIN_RING_BBOX_M2) { droppedTiny++; continue; }
      const simp = simplifyRing(ring);
      if (simp.length < MIN_RING_POINTS) { droppedTiny++; continue; }
      const parts = [];
      for (let i = 0; i < simp.length; i++) {
        const x = (simp[i][0] - global.minX) * scale;
        const y = VH - (simp[i][1] - global.minY) * scale;
        parts.push(`${i === 0 ? 'M' : 'L'}${dec2(x)} ${dec2(y)}`);
      }
      parts.push('Z');
      subpaths.push(parts.join(' '));
    }
    if (subpaths.length === 0) {
      console.warn(`  WARN no rings for NIS ${nis} (${meta.name_fr})`);
      continue;
    }
    features.push({
      nis,
      name_fr: meta.name_fr,
      name_nl: meta.name_nl,
      d: subpaths.join(' '),
    });
  }
  console.log(`${features.length} municipality features (${droppedTiny} tiny rings dropped)`);

  const out = { viewBox: `0 0 ${VW} ${VH}`, features };
  const json = JSON.stringify(out);
  writeFileSync(OUT_PATH, json);
  const sizeKb = (json.length / 1024).toFixed(1);
  console.log(`wrote ${OUT_PATH} (${sizeKb} KB, viewBox=${out.viewBox})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
