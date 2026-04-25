// Build the choropleth dataset from the miambe Belgian municipality polygons +
// the spatie postcode→lat/lng table. We pivot from name-based matching to
// postcode-based matching: broker exports include sub-locality names like
// "STAMBRUGES" or "Maffle" that don't match Statbel's commune names ("Beloeil",
// "Ath"). Postcodes are stable identifiers that don't have this issue.
//
// Inputs (downloaded/cloned ahead of time):
//   1. miambe repo with one geojson file per main CP and a tab-separated
//      `Municipality\tZipCode` list. Each polygon is in WGS84 (lng, lat).
//      Repo: https://github.com/miambe/Municipalities-in-Belgium
//   2. spatie CSV mapping every Belgian postcode to (locality name, lat, lng).
//      Repo: https://github.com/spatie/belgian-cities-geocoded
//   3. (optional) the previous Statbel-derived be_municipalities.json, used
//      ONLY to recover dual FR/NL names per commune. Falls back to the miambe
//      single-name if absent.
//
// Output: data/be_municipalities.json
//   {
//     viewBox: "0 0 1000 H",
//     features: [
//       { cp: "7972", name_fr: "Beloeil", name_nl: "Beloeil", d: "M ... Z" },
//       ...
//     ],
//     cpToCanonical: { "7973": "7972", "1020": "1000", ... }   // every Belgian CP
//   }
//
// Run:
//   node tools/build-municipalities.mjs <miambe-dir> [spatie-csv-or-cache]
//
// The script does point-in-polygon tests in WGS84 (Belgium is small enough that
// lng/lat ray-casting is accurate to a few metres at this scale) — no proj4
// dependency, no CSP risk in the runtime bundle.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_PATH = join(REPO_ROOT, 'data', 'be_municipalities.json');
const OLD_OUT_PATH = OUT_PATH;  // re-read for dual-name fallback

// SVG viewBox width. Height is derived from Belgium's aspect ratio.
const VW = 1000;
// Decimate every Nth point on each ring + min-distance threshold (in SVG
// units). Belgium's bbox at viewBox 1000 wide ≈ 3.8 px/km; below 1px is
// sub-pixel and contributes no visible detail.
const DECIMATE = 3;
const MIN_DIST = 0.6;
const MIN_RING_POINTS = 4;

function dec2(n) { return Math.round(n * 100) / 100; }

function normaliseName(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s'\-]+/g, '');
}

// Ray-casting point-in-polygon in lng/lat. Belgium spans <300km so the
// flat-earth approximation introduces sub-metre error per check, which is fine
// for "which commune contains this CP centroid?".
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = ((yi > lat) !== (yj > lat))
      && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

// Bounding box for fast PIP rejection.
function ringBBox(ring) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const [x, y] of ring) {
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
  }
  return { mnx, mny, mxx, mxy };
}

// Minimal CSV parser for the spatie file: 5 columns, the 2nd is quoted with no
// commas inside (locality names use hyphens/spaces but no commas), the 5th is
// quoted province name. Header: postal,name,lat,lng,province
function parseSpatieCsv(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Match: 1234,"Name with stuff",50.123,4.567,"Province name"
    const m = line.match(/^"?(\d{4})"?,"([^"]*)",([-\d.]+),([-\d.]+),"([^"]*)"$/);
    if (!m) continue;
    out.push({
      cp: m[1],
      name: m[2],
      lat: Number(m[3]),
      lng: Number(m[4]),
    });
  }
  return out;
}

async function fetchSpatie(cachePath) {
  if (cachePath && existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf8');
  }
  const url = 'https://raw.githubusercontent.com/spatie/belgian-cities-geocoded/master/belgian-cities-geocoded.csv';
  console.log(`fetching spatie CSV from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`spatie fetch ${res.status}`);
  const text = await res.text();
  if (cachePath) writeFileSync(cachePath, text);
  return text;
}

async function main() {
  const miambeDir = process.argv[2];
  const spatieCache = process.argv[3] || '/tmp/spatie-be-cities.csv';
  if (!miambeDir) {
    console.error('usage: node tools/build-municipalities.mjs <miambe-dir> [spatie-cache.csv]');
    process.exit(1);
  }

  // ---- 1. Read miambe geojson polygons -----------------------------------
  console.log(`reading miambe geojson from ${miambeDir}/geojson...`);
  const polys = [];   // { cp, ring: [[lng,lat], ...], bbox }
  const geoDir = join(miambeDir, 'geojson');
  for (const f of readdirSync(geoDir)) {
    const m = f.match(/^(\d{4})\.geojson$/);
    if (!m) continue;
    const data = JSON.parse(readFileSync(join(geoDir, f), 'utf8'));
    for (const feat of data.features || []) {
      const g = feat.geometry;
      if (!g) continue;
      // Three miambe files use GeometryCollection (1050 Ixelles, 2387 Baarle,
      // 6780 Messancy). Flatten them to Polygon/MultiPolygon.
      const geoms = g.type === 'GeometryCollection' ? (g.geometries || []) : [g];
      let rings = [];
      for (const sub of geoms) {
        if (!sub) continue;
        if (sub.type === 'Polygon') rings.push(sub.coordinates[0]);
        else if (sub.type === 'MultiPolygon') {
          for (const p of sub.coordinates) rings.push(p[0]);
        }
      }
      if (rings.length === 0) continue;
      for (const ring of rings) {
        if (!ring || ring.length < 4) continue;
        polys.push({ cp: m[1], ring, bbox: ringBBox(ring) });
      }
    }
  }
  console.log(`  read ${polys.length} polygons across ${new Set(polys.map((p) => p.cp)).size} CPs`);

  // ---- 2. Read miambe Municipality↔CP table ------------------------------
  const listText = readFileSync(join(miambeDir, 'list_sorted_by_zipcode.txt'), 'utf8');
  const cpToMiambeName = new Map();
  for (const line of listText.split(/\r?\n/).slice(1)) {
    const t = line.split('\t');
    if (t.length < 2) continue;
    const name = t[0].trim();
    const cp = t[1].trim();
    if (!name || !cp) continue;
    cpToMiambeName.set(cp, name);
  }
  console.log(`  miambe name table: ${cpToMiambeName.size} entries`);

  // ---- 3. Recover dual FR/NL names from the previous Statbel build -------
  // Optional, best-effort. If the file isn't there or names don't match, we
  // fall back to the miambe single name (which is already FR or NL depending
  // on region).
  const dualByNorm = new Map();   // normalisedName → { name_fr, name_nl }
  if (existsSync(OLD_OUT_PATH)) {
    try {
      const old = JSON.parse(readFileSync(OLD_OUT_PATH, 'utf8'));
      for (const f of old.features || []) {
        if (f.name_fr && f.name_nl) {
          const dual = { name_fr: f.name_fr, name_nl: f.name_nl };
          if (f.name_fr) dualByNorm.set(normaliseName(f.name_fr), dual);
          if (f.name_nl) dualByNorm.set(normaliseName(f.name_nl), dual);
        }
      }
      console.log(`  dual-name index from previous build: ${dualByNorm.size} keys`);
    } catch (e) {
      console.warn(`  could not read old build for dual names: ${e.message}`);
    }
  }

  // ---- 4. Read spatie CP→lat/lng (every Belgian CP) ----------------------
  const spatieText = await fetchSpatie(spatieCache);
  const spatieRows = parseSpatieCsv(spatieText);
  console.log(`  spatie CSV: ${spatieRows.length} CP+locality rows`);
  const allCps = new Set(spatieRows.map((r) => r.cp));
  console.log(`  distinct broker CPs: ${allCps.size}`);

  // ---- 5. Build cpToCanonical ---------------------------------------------
  // For each spatie CP, decide which miambe-CP polygon it belongs to.
  //   a) If the CP has its own miambe polygon, it's its own canonical.
  //   b) Otherwise: take the most-common polygon hit across all spatie rows
  //      sharing that CP (handles CPs spanning multiple sub-localities — the
  //      majority centroid wins).
  const polyCpSet = new Set(polys.map((p) => p.cp));
  const tally = new Map();   // cp → Map(canonicalCp → count)
  let pipFails = 0;

  // Group spatie rows by CP for batch PIP.
  const rowsByCp = new Map();
  for (const r of spatieRows) {
    let arr = rowsByCp.get(r.cp);
    if (!arr) { arr = []; rowsByCp.set(r.cp, arr); }
    arr.push(r);
  }

  for (const [cp, rows] of rowsByCp) {
    if (polyCpSet.has(cp)) {
      tally.set(cp, new Map([[cp, 1]]));
      continue;
    }
    // PIP every centroid; aggregate hits.
    const hits = new Map();
    for (const r of rows) {
      let found = null;
      for (const p of polys) {
        const { mnx, mny, mxx, mxy } = p.bbox;
        if (r.lng < mnx || r.lng > mxx || r.lat < mny || r.lat > mxy) continue;
        if (pointInRing(r.lng, r.lat, p.ring)) { found = p.cp; break; }
      }
      if (found) hits.set(found, (hits.get(found) || 0) + 1);
    }
    if (hits.size === 0) { pipFails++; continue; }
    tally.set(cp, hits);
  }

  const cpToCanonical = {};
  for (const [cp, hits] of tally) {
    let best = null, bestN = -1;
    for (const [c, n] of hits) {
      if (n > bestN) { best = c; bestN = n; }
    }
    if (best) cpToCanonical[cp] = best;
  }
  console.log(`  cpToCanonical: ${Object.keys(cpToCanonical).length} entries (PIP miss: ${pipFails})`);

  // ---- 6. Project polygons to SVG viewBox --------------------------------
  // Equirectangular with cos(lat_center) correction. Belgium is small enough
  // that this gives a recognisable shape; we're not making a navigational map.
  let lngMin = Infinity, lngMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  for (const p of polys) {
    const { mnx, mny, mxx, mxy } = p.bbox;
    if (mnx < lngMin) lngMin = mnx;
    if (mxx > lngMax) lngMax = mxx;
    if (mny < latMin) latMin = mny;
    if (mxy > latMax) latMax = mxy;
  }
  const latCenter = (latMin + latMax) / 2;
  const cosLat = Math.cos(latCenter * Math.PI / 180);
  const xSpan = (lngMax - lngMin) * cosLat;
  const ySpan = latMax - latMin;
  const VH = Math.round(VW * (ySpan / xSpan));
  const sx = VW / xSpan;
  const sy = VH / ySpan;
  function project(lng, lat) {
    const x = (lng - lngMin) * cosLat * sx;
    const y = VH - (lat - latMin) * sy;
    return [x, y];
  }

  // ---- 7. Group polygons per CP, simplify, emit features -----------------
  const polysByCp = new Map();
  for (const p of polys) {
    let arr = polysByCp.get(p.cp);
    if (!arr) { arr = []; polysByCp.set(p.cp, arr); }
    arr.push(p);
  }

  function simplify(ring) {
    const out = [];
    let lastX = NaN, lastY = NaN;
    for (let i = 0; i < ring.length; i++) {
      const isLast = i === ring.length - 1;
      if (i !== 0 && !isLast && i % DECIMATE !== 0) continue;
      const [x, y] = ring[i];
      if (!isLast && !Number.isNaN(lastX)) {
        const dx = x - lastX, dy = y - lastY;
        if (dx * dx + dy * dy < MIN_DIST * MIN_DIST) continue;
      }
      out.push([x, y]);
      lastX = x; lastY = y;
    }
    return out;
  }

  const features = [];
  let droppedTiny = 0;
  for (const [cp, ps] of [...polysByCp.entries()].sort()) {
    const subpaths = [];
    for (const p of ps) {
      const proj = p.ring.map(([lng, lat]) => project(lng, lat));
      const simp = simplify(proj);
      if (simp.length < MIN_RING_POINTS) { droppedTiny++; continue; }
      const parts = simp.map(([x, y], i) =>
        `${i === 0 ? 'M' : 'L'}${dec2(x)} ${dec2(y)}`);
      parts.push('Z');
      subpaths.push(parts.join(' '));
    }
    if (subpaths.length === 0) continue;
    const miambeName = cpToMiambeName.get(cp) || cp;
    const dual = dualByNorm.get(normaliseName(miambeName));
    features.push({
      cp,
      name_fr: dual?.name_fr || miambeName,
      name_nl: dual?.name_nl || miambeName,
      d: subpaths.join(' '),
    });
  }
  console.log(`  ${features.length} CP features (${droppedTiny} tiny rings dropped)`);

  // Sanity: every polygon CP should also appear in cpToCanonical mapping to
  // itself; if not, broker rows on that CP would silently fail PIP.
  for (const cp of polysByCp.keys()) {
    if (!cpToCanonical[cp]) cpToCanonical[cp] = cp;
  }

  // ---- 8. Write -----------------------------------------------------------
  const out = { viewBox: `0 0 ${VW} ${VH}`, features, cpToCanonical };
  const json = JSON.stringify(out);
  writeFileSync(OUT_PATH, json);
  const sizeKb = (json.length / 1024).toFixed(1);
  console.log(`wrote ${OUT_PATH} (${sizeKb} KB, viewBox=${out.viewBox})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
