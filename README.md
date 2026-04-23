# portfolio_pwa

Static, installable PWA for analyzing insurance portfolio snapshots. Client-side only — no backend, no server, no sign-up.

Forked in spirit from `avandeneede/insurance_portfolio_analysis` (Flask + SQLite desktop app) and restyled after `avandeneede/breakdown` (iOS-style static PWA).

## Design principles

- **Local first.** SQLite (sql.js / WASM) lives in the browser. The user's Excel files never leave the device.
- **Encrypted cloud backups.** Optional. AES-GCM + PBKDF2 (600k) over a user passphrase. Drop the blob in iCloud Drive / Google Drive / Dropbox — the service only sees ciphertext.
- **Lightweight.** No framework. Vanilla JS + small vendored libs (sql.js, SheetJS, Chart.js, pdfmake).
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

Pre-code. Seeding only. See [`PLAN.md`](./PLAN.md) for the full migration plan, the gstack review findings, and the decisions (D1–D8) that override the original draft.

**Next milestone:** JS port of `reference/analyzer.py` → `src/core/analyzer.js` with a CPython-vs-JS parity harness.

## Not in this repo

- Real client data, real Excel fixtures, `.portfolio` / `.db` / `.sqlite` files. All `.gitignore`d.
- PDFs from the broker (GDPR / PII).
- Authentication, audit log, multi-user — dropped. This is a single-device tool.
