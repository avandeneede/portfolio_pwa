# reference/

Original Python source of the analyzer that this PWA replaces. Kept in
the repo as the **parity baseline** — `tests/parity/run.mjs` runs the JS
port on synthetic fixtures and diffs the output against
`tests/parity/python_baseline.py`, which imports `analyzer.py` from this
folder.

If you change the JS analyzer in `src/core/analyzer.js`, run:

```bash
python3 tests/fixtures/generate.py     # regenerate synthetic data
python3 tests/parity/python_baseline.py # baseline.json
node tests/parity/run.mjs              # diff vs JS port
```

If parity drifts because the Python is also wrong, fix both. If it drifts
because the JS port is wrong, fix the JS port. The Python is the
source-of-truth: it's what real users have been running for years against
real broker data.

## Files

- `analyzer.py` — full ratio + branch-mapping logic, mirrored line-for-line by `src/core/analyzer.js`
- `models.py` — dataclass definitions for the import shapes (clients, polices, sinistres, compagnies)

## Not for production

This folder is dev-tooling only. Nothing in `reference/` is precached by
the service worker or referenced by the PWA at runtime.
