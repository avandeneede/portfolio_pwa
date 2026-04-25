# HISTORICAL PLAN — Static PWA refactor of `insurance_portfolio_analysis`

> **⚠️ This is a historical document.** It captures the original planning at
> project genesis. The PWA has shipped and evolved well past it. For the
> current architecture and status see [`README.md`](../README.md). Kept in
> the repo as a record of the original decisions and trade-offs, not as a
> source of truth for current code.

> **Status (original):** reviewed via `/autoplan`, revised with user overrides, ready for fork + Step 1
> **Branch:** `plan/static-pwa-refactor` (on the current repo); target = new forked repo
> **Deployment:** static PWA on GitHub Pages or Cloudflare Pages
> **Style reference:** `avandeneede/breakdown` (iOS-style primitives, CSS variables, light+dark)

---

## DECISIONS (post-review) — these supersede anything later in the doc

After the /autoplan review flagged 5 critical gaps and 14 high-severity issues, the user chose **option B** — proceed with specific overrides. The overrides below replace the conflicting sections of the original draft.

### D1. Architecture: JS port of `analyzer.py`, no Pyodide.

Drops the 10 MB Pyodide bundle. Fixes review CG1 (`analyzer.py` is not actually drop-in: `open()` at import, date-object expectations). A JS port eliminates both problems, makes the app "lightweight" (user requirement), and keeps cold-start instant.

- `services/analyzer.py` (1043 lines of stdlib Python) → `src/core/analyzer.js`. Pure functions, same signatures, same JSON inputs/outputs. `Counter` → `Map`, `defaultdict(list)` → `Object.create(null)` + array push. Straightforward, boring port.
- Parity tests compare JS output vs CPython output on every fixture in `resources/`. That's the release gate.

### D2. Persistence: local-primary + encrypted cloud backup.

The plan's original "live SQLite file on iCloud, every mutation writes through" model is reversed. iCloud becomes **backup only**, not the hot path. This kills the "last write wins" corruption risk (CG3), the atomic-write risk (CG2), and the sync-latency risk in one change.

```
Hot path (active editing):
  sql.js in memory  ──►  OPFS or IndexedDB (local, same device)
                         (writes every mutation, debounced 300ms)

Backup path (explicit or scheduled):
  sql.js serialize  ──►  encrypt (WebCrypto AES-GCM)  ──►  FS Access API
                                                           writes to
                                                           iCloud / Dropbox / OneDrive
                                                           folder chosen once

Restore path:
  Pick encrypted .portfolio file  ──►  enter passphrase  ──►  decrypt  ──►  load into sql.js
```

Device-to-device flow: work on laptop → "Backup now" (one tap, or scheduled on close) → open iPad → "Restore from backup" (one-time per device; subsequent launches use local cache). This is explicitly a backup-restore model, not live sync. Trade-off: losing device without backup = losing edits since last backup. Mitigation: auto-backup on app close and every N mutations.

### D3. Encryption: passphrase-derived key, WebCrypto AES-GCM.

Addresses GDPR concern raised by CEO + Eng reviews.

- Passphrase set at first launch; changeable from Settings.
- Key derivation: PBKDF2-SHA256, 600k iterations (OWASP 2023 guidance), per-file random salt.
- Encryption: AES-GCM with random 96-bit IV per write.
- On-disk format: `PORTV1` magic bytes + salt(16) + iv(12) + ciphertext + tag(16).
- In-memory key held in a `CryptoKey` object; wiped on idle timeout (default 15 min) → re-prompt.
- **No password recovery.** If the user forgets the passphrase, the backup file is unrecoverable. Spelled out explicitly in UI; recommend they store it in a password manager.
- Local OPFS/IndexedDB storage also encrypted (same key) — keeps device loss safe too.

### D4. UI: responsive across desktop and mobile.

Overrides plan §5's "single column, 560/720/960 max-widths" (which Design review flagged as desktop-abandonment).

- ≤ 640px (phone): single column, full breakdown style. Bottom sheets for modals.
- 641–960px (tablet): single column, wider gutters, side sheets instead of bottom sheets where it fits.
- ≥ 961px (desktop): **2- or 3-column CSS grid** of `.group`s. Sticky sidebar nav (section anchors) on the dashboard. Side sheets and dialogs, not bottom sheets.
- Dashboard on desktop: sidebar nav on left, 2-column group grid on right, sticky bucket filter at top.
- Dashboard on phone: collapsed-by-default groups with headline stat, tap to expand inline.
- "Appearance" setting with Auto / Light / Dark override (not just `prefers-color-scheme`).

Design review's list of missing states (13 of them) + FR copy deck are added to the Step 5 definition-of-done.

### D5. Drop raw-Excel-bytes-in-SQLite (original §9.6).

Eng review: 50 snapshots × 4 files × 3MB = 600MB–1GB DB, which blows the browser array cap when serialized. Dropped entirely. If the broker wants the original Excel, they keep it themselves — we only store parsed structured data.

### D6. Scope and timeline.

CEO + Eng both flagged the plan as 2-3× understated. Revised honest estimate: **10–12 weeks** of focused work for v1, with pdfmake port and encryption crypto as their own milestones. Step 7 in the original plan is split:

| Milestone | Was | Now |
|---|---|---|
| 1. Core port + spike | Pyodide spike | JS port of analyzer.js + parity test harness + sql.js setup |
| 2. Storage + crypto | In step 3 of the original | Dedicated: OPFS/IDB + WebCrypto envelope + backup/restore flow |
| 3. Ingest | Parser | SheetJS parser + header detection |
| 4. UI shell | As before | + responsive desktop grid + states matrix + FR copy deck |
| 5. Dashboard sections | As before | 11 sections wired to analyzer.js |
| 6. Exports + Evolution | Bundled in step 7 | xlsx + csv done here |
| 7. PDF export | One bullet | **Own milestone**, 10-15 days, fidelity decision up front |
| 8. PWA polish | Bundled | manifest, SW, install prompt, offline, i18n cleanup |

### D7. GDPR memo as Step 0 (pre-code).

Before touching any code, write a one-page data-protection memo covering: passphrase-encrypted blob in cloud, no server processing, user's cloud provider as sub-processor, retention controlled by user, right-to-erasure = delete the blob. Get the broker's signoff. If they reject, we know now, not after 10 weeks.

### D8. Fork the repo.

User chose to start fresh. Original Flask app at `avandeneede/insurance_portfolio_analysis` stays untouched (known-good, still ships via PyInstaller). New repo gets the PWA rewrite + `PLAN.md` (this file) + the reference files needed for the port (analyzer.py for source, branch_mapping.json, resources/ fixtures).

Proposed new repo: `avandeneede/portfolio_pwa` (or user-specified name).

### Unchanged from original plan

- Hosting on GitHub Pages (or Cloudflare Pages if bandwidth matters later).
- Style reference: `breakdown`.
- SheetJS for Excel in and out.
- pdfmake for PDF (but now explicitly its own milestone with a fidelity spec).
- FR/NL/EN i18n via static JSON + `Intl` formatters. Add `Intl.PluralRules` per review finding #13.
- No auth, no users table, no audit log.
- Dropping the Flask app's `users` + `audit_log` tables.

---

## Original plan follows (retained for context; sections superseded by D1–D8 above marked)

---

## 1. Architectural decisions

### 1.1 Pyodide vs JS port for analytics

**Decision: Pyodide for `services/analyzer.py`. JS for everything else.**

Evidence:
- `analyzer.py` is 1043 lines and imports only `json`, `os`, `re`, `collections`. Pure Python, stdlib-only, no numpy/pandas. It drops into Pyodide unmodified.
- `parser.py` uses `openpyxl`. `.xls` legacy uses `xlrd`. Both exist in Pyodide, but the browser has a better option in **SheetJS** that reads both formats with a unified API and ships as plain JS. No WASM runtime overhead on the hot path (upload is the hot path).
- `pdf_export.py` uses `reportlab` (928 lines). `reportlab` depends on FreeType and is not a clean Pyodide package. Port to **pdfmake** or **jsPDF**. This is the biggest piece of work in the migration.
- `excel_export.py` (234 lines, openpyxl) — port to SheetJS so we have one Excel dependency, not two runtimes doing the same job.

Summary table:

| Module | Lines | Plan | Rationale |
|---|---|---|---|
| `analyzer.py` | 1043 | **Pyodide, verbatim** | stdlib only, 100% business logic, highest risk to rewrite |
| `parser.py` | 421 | **Rewrite in JS with SheetJS** | Excel I/O belongs at the JS boundary where file pickers live |
| `excel_export.py` | 234 | **Rewrite in JS with SheetJS** | Keep one Excel runtime |
| `pdf_export.py` | 928 | **Rewrite in JS with pdfmake** | reportlab not viable in Pyodide |

Pyodide bundle size: ~10 MB gzipped for the micropip runtime. Acceptable for a tool used weekly by one broker, blocker for casual-visit content. We mitigate with a "warming up..." splash and service-worker caching after first load.

### 1.2 Persistence flow (File System Access API)

**Primary path — Chrome/Edge on desktop, Chrome on Android:**

```
User action                          Browser                       Storage
──────────                           ───────                       ───────
First launch
  → "Pick your portfolio file"  →   showSaveFilePicker()      →   portfolio.sqlite on iCloud Drive
                                    (user names it once)
Every save (after any mutation)
  → serialize sql.js DB         →   FileSystemWritableFileStream → overwrites portfolio.sqlite
  → mirror to IndexedDB         →   IDB put()                 →   local cached copy
Subsequent launches
  → read handle from IndexedDB  →   file.getFile() + sql.js   →   in-memory DB
  → verify modified time        →   check for conflict        →   prompt if file is newer
```

Key details:
- **File handle persists** across sessions via IndexedDB (`navigator.storage.persist()` keeps it alive).
- **Every mutation writes through** — no "save" button. The user's file is the source of truth.
- **iCloud / Dropbox / OneDrive / Drive** all work because the FS API writes to whatever folder the user picked; the cloud provider's local agent handles sync.
- **Conflict handling**: on open, compare file's `lastModified` with last-known-good timestamp stored in IndexedDB. If newer, offer "reload from file" vs "keep local and overwrite."

**Fallback path — Safari (desktop and iOS), Firefox:**

File System Access API is not supported. We degrade to:
- IndexedDB as primary store (sql.js DB serialized on every mutation).
- `navigator.storage.persist()` requested on first mutation with explicit rationale in-UI.
- Explicit **Export** button (downloads `portfolio-YYYYMMDD.sqlite` to the Downloads folder).
- Explicit **Import** button (replaces current DB with a picked file).
- Prominent banner: *"Your data lives in this browser. Use Export weekly to back up."*
- Proactive nudge after every N writes (e.g. 10) and after every snapshot import: "Back up now?" with a one-click download.

**Shared behavior both paths:**
- sql.js DB lives in-memory during a session.
- Every mutation → serialize → write to active storage (FS file OR IndexedDB).
- A debounced write (300 ms) batches rapid successive changes.
- Storage quota monitored via `navigator.storage.estimate()`; warn at 80%.

### 1.3 sql.js schema strategy

One `portfolio.sqlite` file. Same tables as the Flask app, minus auth concerns (see §4).
The file is portable — a broker can email it to their accountant, diff it, restore from backup.

---

## 2. File / module structure

```
insurance_portfolio_analysis/
├── index.html                 # single-page shell, inline critical CSS, loads app.js
├── manifest.json              # PWA manifest
├── sw.js                      # service worker (precache + runtime cache)
├── icon-{16,32,64,180,192,512,1024}.png   # matches breakdown naming
├── src/
│   ├── app.js                 # entry: boot, router, first-launch flow
│   ├── store/
│   │   ├── db.js              # sql.js instance + serialize/deserialize
│   │   ├── fs.js              # File System Access API wrapper + IDB handle storage
│   │   ├── idb.js             # IndexedDB fallback storage
│   │   └── sync.js            # debounced write-through + conflict detection
│   ├── py/
│   │   ├── runtime.js         # Pyodide bootstrap, lazy load, warmup
│   │   └── analyzer.py        # COPIED VERBATIM from services/analyzer.py
│   ├── ingest/
│   │   ├── parser.js          # SheetJS-based replacement for services/parser.py
│   │   └── signatures.js      # file identification by header content
│   ├── export/
│   │   ├── xlsx.js            # SheetJS-based CLIENT TOTAL + Opportunities
│   │   ├── pdf.js             # pdfmake-based 10-page report
│   │   └── csv.js             # tiny stdlib
│   ├── screens/
│   │   ├── home.js            # snapshot list + "new snapshot" CTA
│   │   ├── upload.js          # drag-drop / file picker for .xls/.xlsx
│   │   ├── dashboard.js       # 11-section dashboard with bucket filter
│   │   ├── evolution.js       # cross-snapshot metric tree + chart
│   │   └── settings.js        # language, storage, backup, about
│   ├── ui/
│   │   ├── chrome.js          # nav, sheets, toasts (reuse breakdown patterns)
│   │   ├── charts.js          # Chart.js thin wrapper
│   │   ├── sheet.js           # bottom sheet component (port from breakdown)
│   │   └── i18n.js            # translation lookup + active language
│   └── styles.css             # CSS variables + component classes (single file)
├── locales/
│   ├── fr.json
│   ├── nl.json
│   └── en.json
├── vendor/                    # pinned copies — no CDN dependency at runtime
│   ├── sql-wasm.js, sql-wasm.wasm
│   ├── pyodide/               # pyodide core (lazy loaded)
│   ├── xlsx.full.min.js       # SheetJS
│   ├── pdfmake.min.js, vfs_fonts.js
│   └── chart.umd.min.js
├── config/
│   └── branch_mapping.json    # COPIED VERBATIM
├── .github/workflows/
│   └── pages.yml              # GitHub Pages deploy workflow
└── LEGACY/                    # archived Flask app files (removed before deploy)
```

**Why vendor dependencies instead of CDN?** GitHub Pages has no egress rules, but CDN failure = app dead. A 15 MB vendor/ directory on GH Pages is free. Reproducible too — no surprise breakages when a CDN rolls.

**Why no build step?** Breakdown is a single-file static site. Staying buildless keeps GitHub Pages deploy trivial (push → live). We use native ES modules (`<script type="module">`) and let the browser resolve imports. If bundle size becomes a problem, add esbuild later.

---

## 3. Migration order

A seven-step progression, each step shippable and testable in isolation.

**Step 1 — Spike: Pyodide + analyzer.py round-trip.**
- New branch `spike/pyodide`. Load Pyodide, import `analyzer.py` unmodified, call `compute_all_stats()` with fixture data from `resources/`. Confirm outputs byte-identical to Flask baseline.
- Go/no-go gate. If Pyodide blows up on anything in analyzer, we switch to JS port before investing further.

**Step 2 — sql.js + schema.**
- Write `store/db.js`. Hand-translate SQLAlchemy models to a `CREATE TABLE` SQL file. Load in sql.js. Write fixture seed + assertions.

**Step 3 — Storage layer.**
- Implement `store/fs.js` (FS Access API path) and `store/idb.js` (fallback). Feature-detect and pick one. Verify round-trip: create DB → write → close tab → reopen → state preserved.

**Step 4 — Ingest: parser.js.**
- Port `services/parser.py` to JS using SheetJS. The header-based file identification logic is pure string matching — drops in 1:1. Covers `.xlsx` and `.xls` (SheetJS handles both). Validate with every file in `resources/`.

**Step 5 — UI shell matching breakdown.**
- Write `index.html` + `styles.css` with breakdown's CSS variables, `.wrap`, `.hero`, `.group`, `.row`, `.sheet` patterns. Screens: home (snapshot list), upload, dashboard placeholder, settings.

**Step 6 — Dashboard sections (11 of them).**
- Wire Pyodide-computed stats to Chart.js views. Each section is a `screens/dashboard.js` module rendering one breakdown-style group. Bucket filter is a `.segmented` control at the top of the screen.

**Step 7 — Exports + evolution + polish.**
- pdfmake port of `pdf_export.py` (the long one).
- SheetJS port of `excel_export.py`.
- Cross-snapshot evolution view.
- PWA: manifest, service worker, install prompt, offline shell.
- i18n: extract strings, load JSON, wire language switcher.

**Throw away from the Flask app:**
- `app.py`, `auth.py`, `middleware.py`, `config.py`, `launcher.py` — entire server.
- `routes/` — replaced by client-side router.
- `templates/` — replaced by JS-rendered screens.
- `services/parser.py`, `services/excel_export.py`, `services/pdf_export.py` — ported to JS.
- `portfolio.db`, `backups/`, `uploads/` — obsolete.
- `portfolio_analyzer.spec`, `build_mac.sh`, `build_win.bat`, `dist/`, `build/` — no more PyInstaller.
- `requirements.txt` — no more Python deps at runtime.
- `tests/` — rewrite (see §8).
- `models.py` — replaced by `schema.sql`.
- `babel.cfg`, `messages.pot`, `translations/*.po` — converted to JSON (see §6).

**Port verbatim:**
- `services/analyzer.py` → `src/py/analyzer.py` (single-line change: adjust `load_branch_mapping` default path).
- `config/branch_mapping.json` → `config/branch_mapping.json`.
- `resources/` test snapshots → QA fixtures (see §8).

---

## 4. Data model mapping

Target SQLite schema (source of truth is `schema.sql`, loaded into sql.js on first launch):

```sql
-- Dropped: users table, audit_log table (no auth, single-device tool)

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,          -- ISO date
  label TEXT,
  stats_json TEXT,                      -- cached precomputed stats
  client_total_json TEXT,               -- cached enriched client list
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  dossier TEXT, sous_dossier TEXT, dossier_key TEXT,
  -- ... all fields from models.py Client
);
CREATE INDEX idx_clients_snapshot_dossier ON clients(snapshot_id, dossier_key);

-- Same pattern for polices, compagnie_polices, sinistres.
```

Changes from the SQLAlchemy schema:
- **Drop `users`** — no auth, no user concept. Snapshots no longer have a `user_id` FK.
- **Drop `audit_log`** — single-device tool. The OS and the sync provider (iCloud) log file changes; a per-app audit table adds no value and would need manual pruning. If a future version ever syncs between devices we add it back.
- **Dates as ISO strings** (`TEXT`) rather than DATE — SQLite has no real date type, and sql.js surfaces dates inconsistently across driver versions. Storing ISO strings keeps JSON round-trips clean.
- Everything else preserved, including the indexes.

Migration path from an existing Flask `portfolio.db`:
- One-off **import** flow in the settings screen: "Import from Flask app DB." User picks a `portfolio.db`. We open with sql.js, for each user's snapshots copy rows into the new schema (ignoring user_id), and write the resulting file to the FS Access handle.
- This is a one-way door — no sync back. Documented in-app.

---

## 5. UI structure (mobile-first, breakdown-style)

**Layout primitives, copied from breakdown:**
- Single `.wrap` column, max-width 560px on phone, 720px on tablet, 960px on desktop. Content stays one column; wider viewports get more padding and larger type.
- `:root` CSS variables for light/dark mode (`--bg`, `--card`, `--accent`, etc.), inheriting breakdown's palette exactly.
- `.hero` header with title + primary stat.
- `.group` = rounded card containing `.row` items, iOS-style.
- `.sheet` = bottom-slide-up modal for edits, pickers, confirmations.
- `.segmented` = iOS-style pill toggle for filters.
- Tabular numerics everywhere (`font-variant-numeric: tabular-nums`) — critical for number-heavy insurance data.

**Screen inventory:**

| Screen | Purpose | Components |
|---|---|---|
| **Home** | List snapshots, open one, create new | hero (count + latest date), `.group` of snapshot rows with `.chevron`, FAB for "+" |
| **Upload** | Drop / pick 1–4 Excel files | drop zone, file-type auto-detection feedback, date picker, label field |
| **Dashboard** | 11-section analytics for one snapshot | top sticky bar with bucket `.segmented`, 11 `.group`s one per section, each with a small chart + `.row` items |
| **Evolution** | Cross-snapshot metric tree + chart | metric tree sheet, Chart.js line over time, bucket filter |
| **Export** | Pick format + filters | bottom sheet with xlsx/csv/pdf rows |
| **Settings** | Language, storage, backup, about | `.group` of rows (language picker sheet, storage status, export/import, clear data, version, github link) |

**Mobile-first details:**
- All controls ≥ 44 px tap target.
- Bottom sheets, not popovers, for anything that needs user input — they're reachable on a phone.
- `env(safe-area-inset-*)` everywhere (matches breakdown).
- 11-section dashboard on phone = vertical scroll; on desktop, stays one column (breakdown aesthetic), not a dashboard grid. Consistency across devices beats information density.
- Charts: Chart.js at `devicePixelRatio` with `maintainAspectRatio: false`, each chart in a container of fixed aspect (16:9 on phone, 2:1 on desktop).

**Information hierarchy for the dashboard (one screen, ordered):**
1. Hero: snapshot label, date, "(filtered by: AUT, VIE)" if bucket filter active.
2. Bucket `.segmented` — sticky at top when scrolling.
3. Groups in order: Overview, KPI Summary, Opportunities, Branches, Companies, Policies per Client, Geographic, Demographics, Civil Status, Subscription Index, Data Quality.
4. Opportunities moved up to position 3 (originally last) — brokers open the app to find work; show opportunities before statistics.

---

## 6. i18n strategy

Flask-Babel `.po/.mo` → JSON files served statically.

**Extraction step (one-time, during migration):**
- Script: walk `translations/*/LC_MESSAGES/messages.po`. For each msgid/msgstr pair, write to `locales/{fr,nl,en}.json` as flat keys (not nested — matches breakdown, avoids ambiguity).
- Keys match the original Jinja `_('string')` calls. Example: `{"snapshot.list.title": "Snapshots", ...}`.

**Runtime:**
- Lightweight i18n — no library needed. `i18n.t(key, params?)` = ~30 lines:
  ```js
  let dict = {};
  export async function loadLang(lang) {
    dict = await (await fetch(`locales/${lang}.json`)).json();
  }
  export const t = (key, params) => {
    let s = dict[key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
    return s;
  };
  ```
- Active language stored in IndexedDB, not in the SQLite file (it's a device preference, not portfolio data).
- Default: `fr`. Detect browser `navigator.language` on first run, offer in a sheet.

**Number and date formatting:**
- `Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' })` everywhere — cleaner than the Flask version's hand-rolled European format functions.
- `Intl.DateTimeFormat(lang, ...)` for dates.

**PDF and Excel exports:**
- Same `t()` function + same JSON. The PDF port (§1.1) uses the active language's dict for labels; Excel sheet names and headers likewise.

---

## 7. PWA concerns

**`manifest.json`** (cloned from breakdown's shape, updated fields):
```json
{
  "name": "Portfolio Analyzer",
  "short_name": "Portfolio",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#f2f2f7",
  "theme_color": "#f2f2f7",
  "orientation": "portrait",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ],
  "lang": "fr"
}
```

**Service worker (`sw.js`):**
- Precache the app shell (`index.html`, `styles.css`, `app.js`, icons, `manifest.json`).
- Runtime-cache vendor/ (sql.js, Pyodide, SheetJS, pdfmake, Chart.js) — these are immutable, cache-first.
- `locales/*.json` — stale-while-revalidate.
- Never cache user data (it's not fetched — it's in sql.js in memory).
- Versioned cache name (`portfolio-v1`) for clean upgrades.

**Offline:**
- Once installed, the app works offline indefinitely. No network needed.
- First load requires network to fetch Pyodide (~10 MB). Show a progress bar.
- Subsequent launches cold-start in <1 s from cache.

**Persistent storage request:**
- First time the user creates or imports a snapshot, call `navigator.storage.persist()`. If rejected, show a one-time callout: *"Your browser may delete data under storage pressure. Tap Install to make storage permanent."* and link to the install prompt.
- Also call on every app launch (idempotent in Chrome; no-op if already granted).

**Install prompt:**
- Capture `beforeinstallprompt`, stash it. Surface an "Install app" row in Settings and a banner after the third session.

---

## 8. Testing strategy

Testing a Pyodide/WASM static app is different from testing Flask. Three tiers:

**Tier 1 — analyzer.py parity tests (fastest, most valuable):**
- Run the **same** `analyzer.py` in two environments: stock CPython (via pytest) and Pyodide (via Playwright + page.evaluate).
- Feed the same fixture data from `resources/`. Assert outputs are byte-identical JSON.
- If this ever diverges, it's a Pyodide bug, not ours — and the parity test catches it before release.

**Tier 2 — integration via Playwright (replaces Flask-level tests):**
- Headless Chromium. Real sql.js, real Pyodide, real File System Access (Playwright supports it via `page.context().grantPermissions`).
- Scenarios:
  1. First-launch flow: pick file, create snapshot from fixture xlsx, verify dashboard renders expected numbers.
  2. Persistence: launch → mutate → close → relaunch → verify state restored.
  3. Fallback: launch in Firefox, do the same flow via IndexedDB path.
  4. Export round-trip: export xlsx, re-import, verify structure.
  5. Language switch: set NL, assert headers/labels in Dutch.

**Tier 3 — unit tests for JS modules (Vitest):**
- `parser.js` — feed binary xlsx fixtures, assert parsed structures match Flask parser's outputs (captured as golden JSON).
- `fs.js` / `idb.js` — mock FileSystemHandle / IndexedDB, verify write debouncing and conflict detection.
- `export/xlsx.js` — generate, parse with SheetJS, assert content.

**What is NOT tested:**
- PDF pixel-identity to the reportlab output. The layout will differ; we test *content* (every expected string and chart is present) and do visual QA manually.
- CDN behavior — we vendor.

**CI:** GitHub Actions workflow runs Tier 1 + Tier 3 on every push, Tier 2 on PRs to `main`.

---

## 9. What is LOST vs the Flask version

Non-negotiable losses — inherent to the "no backend" choice:

1. **Multi-user.** Everyone using a given `portfolio.sqlite` file is the same user to the app. Users/roles/admin panel all gone. If two people edit the file at once via cloud sync, whoever saves last wins. Mitigation: single-broker deployments only; document the "one editor at a time" expectation.
2. **Audit log.** No `audit_log` table. Brokers wanting traceability rely on their iCloud version history (time machine-like).
3. **Server-side CSRF / rate limiting / session timeouts / security headers / HSTS.** All obsolete — no server to attack. New surface: the SQLite file itself is sensitive (PII); its security is now the user's cloud account security.
4. **Central backups.** No `backups/` directory written by the server. Replaced by the user's cloud provider (iCloud has file versioning) + manual Export button.
5. **Server-side bucket filter recomputation.** In the Flask app, bucket filtering re-queries SQL. In the PWA, we run the same computation in Pyodide/WASM on the client. Snapshots with very large police tables (>100k rows) will be noticeably slower here. Mitigation: progress indicator; worst-case budget ~2 s for 100k-row recompute on a mid-tier phone.
6. **Upload of raw files kept on disk.** Flask stored the original `.xlsx` in `uploads/{snapshot_id}/`. The PWA discards the raw file after parsing — only the structured data is stored. If the user wants to re-examine the original, they keep it themselves. Alternative: store the raw file bytes in a `snapshot_raw` table in SQLite — adds ~500 KB per snapshot, worth it for compliance, include in v1.
7. **PDF pixel-parity.** Existing PDFs from reportlab will look different from pdfmake PDFs. Content-equivalent, not visually identical. If a customer compares old and new reports side-by-side they will notice. Document this in the release notes.
8. **Two-factor / password complexity / admin reset.** Removed with auth.
9. **Automatic DB backup on import.** Replaced by cloud version history. Document the iCloud restore flow in the Settings "About" sheet.
10. **Concurrent reads via SQLite WAL mode.** Irrelevant in a single-user browser; mentioned only so the reviewer doesn't ask.

Non-obvious gains to mention for balance:
- Zero install (open URL, works).
- Zero server ops (no admin/admin default, no bcrypt patching, no CVE watch on Flask deps).
- Works offline, on any device, any OS.
- Data portability — the `portfolio.sqlite` file is the user's asset.

---

## 10. GitHub Pages deployment

**Repo setup:**
- Branch `main` = deployed. Branch `plan/static-pwa-refactor` = this plan + migration work until merged.
- GitHub Pages source: "GitHub Actions" (not legacy "deploy from branch"). Cleaner; no `gh-pages` branch.

**Workflow (`.github/workflows/pages.yml`):**
```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - name: Upload static site
        uses: actions/upload-pages-artifact@v3
        with:
          path: .    # buildless — serve repo root as-is
      - id: deployment
        uses: actions/deploy-pages@v4
```

**Path / base URL:**
- Deployed at `https://avandeneede.github.io/insurance_portfolio_analysis/`.
- All asset paths in `index.html`, `manifest.json`, `sw.js` are **relative** (`./icon-192.png`, `./vendor/sql-wasm.js`) — not root-absolute. Matches breakdown's approach; works on both user-site and project-site deploys.

**Custom domain (optional, deferred):**
- If the user wants `portfolio.avandeneede.com`, add a `CNAME` file at repo root and configure DNS. Not blocking for v1.

**HTTPS:**
- GitHub Pages enforces HTTPS. Required for service workers, File System Access API, and `navigator.storage.persist()`. No config needed.

**Deployment before code is ready:**
- The `main` branch is publicly deployable from day one. Until the refactor lands, either (a) point Pages at a placeholder `index.html`, or (b) configure Pages to deploy from the `release` branch and keep `main` = Flask app until we're ready. Recommend (a) for simplicity.

**Removing the Flask app from `main`:**
- One big commit at cutover. We archive the Flask app in a `legacy-flask` branch for reference and remove it from `main`. History is preserved via the branch ref.

---

## GSTACK REVIEW REPORT

Run: `/autoplan` @ 27f67ec on `plan/static-pwa-refactor`. Single-voice mode (Codex unauthed).

| Phase | Source | Status | Critical | High | Med |
|---|---|---|---|---|---|
| CEO | Claude subagent | issues_open | 2 | 5 | 3 |
| Design | Claude subagent | issues_open | 0 | 3 | 5 |
| Eng | Claude subagent | issues_open | 5 | 6 | 4 |
| DX | skipped — not developer-facing | — | — | — | — |

**Overall verdict: YELLOW — revise before starting.** Three ship-blockers, one false technical premise, two underscoped deliverables.

### Cross-phase themes (flagged in 2+ reviews)

1. **GDPR / PII posture on iCloud is absent.** CEO + Eng both flag. The plan never addresses that storing unencrypted Belgian insurance client data in a consumer cloud folder has regulatory implications (DPIA, encryption at rest, DPA with Apple). This is the single biggest gap.
2. **Scope is 2-3× understated.** CEO says "8-12 weeks, not 4." Eng confirms pdfmake port alone is 10-15 days (§7.5 of plan hides it in a single bullet). Both flag the plan's step-granularity as misleading.
3. **"Last write wins" for PII is unacceptable.** Eng flags as CG3; CEO flags as "time bomb." iCloud is a file replicator, not a sync engine for live SQLite.
4. **Desktop abandonment.** Design + CEO both flag that 560 px column on a 27" monitor is aesthetic cargo-culting from `breakdown` and hurts the broker's actual workflow.
5. **Underspecification.** Design found 13 missing states; Eng found 5 critical gaps; CEO flagged 4 dismissed alternatives. The plan describes primitives, not decisions.

### Critical ship-blockers (Eng)

- **CG1 — "analyzer.py drops in verbatim" is FALSE.** `analyzer.py:15` does `open(config_path)` at import time (hits Pyodide virtual FS, not `fetch()`). Worse: `analyzer.py:200,571,591,710` call `hasattr(dn, 'year')` expecting real `date` objects; JSON round-trip from sql.js yields strings, so demographics/opportunities/succession/young_families silently return empty. The #1 justification for choosing Pyodide is incorrect as stated. Fix required in Step 1 acceptance criteria.
- **CG2 — No atomic write.** Single browser crash mid-serialize = corrupt SQLite file. Need `.tmp` → rename + generation counter.
- **CG3 — "Last write wins" unacceptable for insurance PII.** Need `db_version` column, refuse-stale-overwrite, conflict-resolution UI.
- **CG4 — pdfmake port scoped as one bullet.** Realistic 10-15 engineering days; reportlab has charts and flowables pdfmake lacks. Must be its own milestone with fidelity decision up front.
- **CG5 — Flask→PWA import has no transaction boundary.** Partial import of a 200k-row DB can leave orphan state.

### What the CEO review actually says

Bottom line from CEO subagent: **"Revise, bordering on kill."** The migration solves a non-acute problem (hosting cost — current app is PyInstaller, already $0) while introducing acute risks (GDPR, corruption, PDF drift, retraining). Stronger alternatives not explored:

- Restyle Flask app with breakdown's CSS (~1 week, 90% of the aesthetic win)
- Deploy Flask to Fly.io or €5 VPS (turns desktop icon into URL, keeps multi-user option open)
- PWA + Supabase free tier (true sync, auth, EU region — "free" but with a real backend)
- Native macOS / Tauri wrapper (honest answer to "desktop-like offline app")
- Embed in Odoo (user is already in Odoo ecosystem per environment)

### What the Design review actually says

Architecture side of the plan is defensible; **UI plan (§5) would ship a technically correct, usability-poor app.** Before code starts, §5 needs: first-run zero-state, states matrix (13 missing), desktop layout spec (not just "more padding"), FR copy deck, sync-conflict sheet spec, accessibility subsection, search/jump pattern, dashboard compaction rule.

### Auto-decisions taken

Using the 6 autoplan principles (completeness, boil-lakes, pragmatic, DRY, explicit, bias-to-action):

| # | Decision | Principle | Rationale |
|---|---|---|---|
| 1 | Accept Eng CG1-5 as must-fix in Step 1 | P1 completeness | Can't ship a plan with a false technical premise |
| 2 | Accept Design asks for §5 additions (13 states, desktop layout, copy deck, a11y) | P1 completeness | Unspecified UI = bad UI shipped |
| 3 | Accept adding GDPR memo as Step 0 | P1 + P6 bias-to-action | Broker-facing PII + EU = non-negotiable |
| 4 | Upgrade pdfmake port from bullet to milestone | P5 explicit | Burying 15 days of work is planning malpractice |
| 5 | Scope estimate revised 4w → 10-12w | P5 explicit | Match the actual work |
| 6 | Add CSP, supported-browser matrix, iOS storage budget test | P1 completeness | Free with the rewrite, costly to retrofit |

### User challenges (both review voices recommend changing your direction)

These are NOT auto-decided. They require your judgment.

**Challenge 1: Do this migration at all.**
- You said: rewrite as static PWA on GitHub Pages (option A from our conversation).
- Both reviews recommend: don't. CEO says "revise, bordering on kill." Eng says yellow-light with 5 ship-blockers.
- Why: the premise ("free hosting on GitHub" / "browser as thin client") solves a problem you don't have (current app is PyInstaller, cost = $0) while introducing GDPR, corruption, and scope risks.
- What we might be missing: you may have reasons I don't know about — portfolio value as a demo/hiring artifact, commitment to PWA model for future products, specific commitment to the iCloud-file approach as a design exercise. Conversation context was "free hosting on GitHub" which is exactly the premise being challenged.
- If we're wrong, the cost is: you spend a week revisiting, maybe conclude the PWA approach is still right for non-cost reasons, and start anyway.

Your call. Your direction stands unless you change it.

**Challenge 2: Mobile-first single-column on desktop.**
- You said: match `breakdown` styling.
- Design subagent recommends: copy `breakdown`'s primitives (`.group`, `.row`, `.sheet`) but abandon single-column on ≥960px — use a 2-3 column grid of groups. Reason: broker does desk work on 27" monitors; 560px column there is empty space.
- If we're wrong, the cost is: app looks less pure; broker has to scroll more — but the broker has always scrolled less because dashboards are dense.

**Challenge 3: Store raw Excel files in SQLite (§9.6).**
- You said (implicit in plan): "include in v1, adds ~500KB per snapshot."
- Eng subagent: real xlsx with 10k polices is 2-5MB. 50 snapshots × 4 files × 3MB = 600MB-1GB DB. sql.js serializes entire DB to one Uint8Array — hits mobile Safari's array cap. Drop feature, or store raw files sibling to DB.
- If we're wrong: you re-add it in v2 when you have real numbers.

### Taste decisions

1. **Pyodide vs JS port of analyzer.py.** Recommend: JS port. Why: CG1 shows analyzer isn't actually "drop-in," AND 10MB first-load is a UX regression from the PyInstaller instant-launch. One week of JS work eliminates the Pyodide tax forever. But: keeping Python preserves parity tests and is closer to "port verbatim." Close call.
2. **GitHub Pages vs Cloudflare Pages.** Recommend: Cloudflare Pages. Why: 500k requests/month, no bandwidth cap, identical dev ergonomics, also free. GitHub Pages wins only on "repo and deploy are the same place."
3. **Optional SQLCipher passphrase for the SQLite file.** Recommend: yes, as optional setting. Addresses GDPR somewhat; but adds UX friction and password-reset impossibility. Close call.

### Deferred to follow-up (if plan proceeds)

- GDPR / DPIA memo (Step 0, blocking)
- Broker runbook for install + first-run flow
- Supported-browsers matrix
- Success metric from the broker ("monthly analysis in X minutes," "zero data loss over 3 months")
- Benchmark fixture for 100k-row Pyodide recompute (go/no-go gate)

---

## Open questions for review

These are the places I'd expect `/autoplan`'s CEO and Eng voices to push back:

1. **Is the Pyodide 10 MB budget acceptable for first load?** Alternative: port `analyzer.py` to JS (bigger effort, smaller download).
2. **Store raw uploaded files in SQLite or drop them?** §9.6. Affects file size and compliance posture.
3. **Do we want GitHub Pages or a cheap static host (Cloudflare Pages, Netlify) that has identical dev ergonomics and more generous limits?** §10.
4. **Is "single editor at a time" via cloud sync acceptable?** §9.1. Could add a lock file next to `portfolio.sqlite`, but it's ugly.
5. **How faithful does the PDF export need to look?** §9.7. Drives how much of `pdf_export.py` we port vs simplify.
6. **Timeline / staging.** 7 steps in §3 — do we merge each to `main` (users see a partial PWA while Flask app is still there), or do we build on a long-lived branch and do one big switchover?
