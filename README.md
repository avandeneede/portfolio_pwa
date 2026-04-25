# portfolio_pwa

Static, installable PWA for analyzing insurance portfolio snapshots. Client-side only — no backend, no server, no sign-up.

Forked in spirit from `avandeneede/insurance_portfolio_analysis` (Flask + SQLite desktop app) and restyled after `avandeneede/breakdown` (iOS-style static PWA).

## Design principles

- **Local first.** SQLite (sql.js / WASM) lives in the browser. The user's Excel files never leave the device.
- **Encrypted cloud backups.** Optional. AES-GCM + PBKDF2 (600k) over a user passphrase. Drop the blob in iCloud Drive / Google Drive / Dropbox — the service only sees ciphertext.
- **Source-of-truth Excel files.** The original XLSX bytes are stored alongside parsed rows so the app can re-derive every snapshot from source after a parser change. Auto-fires on every app update — no re-uploads.
- **Lightweight.** No framework. Vanilla JS, native ES modules, screens lazy-loaded so first paint stays cheap. Small vendored libs (sql.js, SheetJS, pdfmake), each pinned with SRI hashes — generate/refresh via `node tools/vendor-integrity.mjs`.
- **Coaching, not just charts.** The Evolution page's ratios summary is grouped by theme (overview → demographics → data quality → multi-equipment → policies → product mix → premiums → commissions → claims). Each row carries an "Action corrective ?" button that opens a coaching card: summary, what an up/down move means, and one concrete corrective action.
- **Responsive.** Desktop and mobile. Breakdown's primitives: `.wrap`, `.hero`, `.group`, `.row`, `.sheet`, `.segmented`, CSS vars for light/dark.
- **Installable.** manifest.json + service worker. Works offline after first load.

## Target architecture

```
src/
  core/
    analyzer.js          # JS port of services/analyzer.py (pure, deterministic)
    domain.js            # entities + branch mapping
  store/
    db.js                # sql.js wrapper (schema, migrations)
    crypto.js            # WebCrypto AES-GCM + PBKDF2
    local.js             # OPFS / IndexedDB persistence
    backup.js            # encrypted blob export/import for cloud folders
  ingest/
    parser.js            # SheetJS .xlsx/.xls → rows, file-type detection
    preview.js           # staging + warnings before commit
  export/
    xlsx.js
    pdf.js               # pdfmake (replaces reportlab)
    csv.js
  screens/
    snapshots.js
    dashboard.js
    clients.js
    compagnies.js
    sinistres.js
    evolution.js
  ui/
    sheet.js segmented.js chart.js toast.js
  i18n/
    index.js             # flat JSON + Intl.PluralRules
locales/
  fr.json nl.json en.json
config/
  branch_mapping.json
vendor/
  sql.js sheetjs chart.js pdfmake
sw.js manifest.webmanifest index.html
```

## Status

MVP shipped. All core flows are in: snapshot upload (Excel → parse → preview → commit), dashboard (KPIs + 7 sections computed client-side from the parity-verified analyzer), encrypted backup export/import, settings, offline service worker.

- **Analyzer snapshot** (`tests/snapshot/run.mjs`): JS-only field-level diff against `tests/snapshot/baseline.json` on 300-client synthetic fixtures. Catches any drift in the 11 stat sections, flat metrics, tree, or per-client roll-up.
- **Smoke tests** (`tests/smoke/run.mjs`): crypto round-trip, wrong-passphrase/corruption guards, SheetJS parse, sql.js schema+insert+fetch+export.
- **Locale parity** (`tests/locales/run.mjs`): every key present in any locale file must be present in all of them, with non-empty values. Prevents UI showing raw `evolution.empty_desc` in NL/EN.
- **Type check** (`tsc --noEmit` via JSDoc): scoped to `src/core`, `src/store`, `src/ingest` — the parts where a wrong type means a wrong number for a broker. UI screens are not yet covered (deliberate, see `tsconfig.json`).
- **Version lockstep** (`tools/release.mjs --check`): asserts `APP_VERSION` and `CACHE_VERSION` are in sync. Enforced as a pre-commit hook (`tools/git-hooks/install.sh`) and in CI.
- **Cross-validation** (`tests/parity/`, historical): one-shot JS ↔ Python diff against the original `reference/analyzer.py`. Stale (the JS is now richer than the Python), kept as a developer cross-check tool, not a CI test.
- **Deploy**: GitHub Actions → Pages, static, no build step. Full test matrix runs before deploy.

### v51 — security + a11y + boot UX

- Cloud-sync passphrase encrypted at rest (PBKDF2 + AES-GCM, device-bound key) — never plaintext in IndexedDB.
- CSP tightened: `style-src 'self'` only, all transitions class-driven (no `unsafe-inline`).
- Subresource Integrity (SRI) hashes on every vendored lib, regen tool at `tools/vendor-integrity.mjs`.
- Screen modules lazy-loaded; boot UI shows staged progress (DB → vendor → screen).
- Accessibility: focus trap + `aria-labelledby` on passphrase and opportunity-detail modals; skip-link target focusable; translated labels for info popovers.
- Toasts gain an action button — failed XLSX export, upload commit, and preview confirm now offer one-tap Retry.
- Multi-file uploads: parse failures roll up into a single inline panel (filename + reason) instead of N stacked toasts.
- Empty states: Evolution zero/one-snapshot CTAs.
- Refactor: opportunity modal extracted from `dashboard.js` into `src/screens/dashboard_opp.js`.
- Dead `vendor/chartjs/` removed (charts are SVG, hand-rolled in `src/ui/charts.js`).

## Running locally

```bash
# Static serve — any HTTP server works. COOP/COEP not required.
python3 -m http.server 8000
# → http://localhost:8000/

# Tests (the same set CI runs)
node tools/release.mjs --check         # version lockstep
node tests/locales/run.mjs             # locale key parity
node tests/smoke/run.mjs               # crypto + parser + db
node tests/snapshot/run.mjs            # analyzer field-level snapshot
npx -y -p typescript@^6 tsc --noEmit   # JSDoc-driven type check

# Optional: install the pre-commit hook (enforces version lockstep on every
# commit, no npm/husky needed).
tools/git-hooks/install.sh

# Optional: regenerate synthetic fixtures and cross-validate against Python.
python3 tests/fixtures/generate.py
python3 tests/parity/python_baseline.py
node tests/parity/run.mjs              # JS ↔ Python (historical, see tests/parity/README.md)
```

## Not in this repo

- Real client data, real Excel fixtures, `.portfolio` / `.db` / `.sqlite` files. All `.gitignore`d.
- PDFs from the broker (GDPR / PII).
- Authentication, audit log, multi-user — dropped. This is a single-device tool.
