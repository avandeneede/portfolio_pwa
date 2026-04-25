# tests/snapshot/

Hermetic JS-only test for the analyzer pipeline. Runs `computeAllStats`,
`computeClientTotal`, `extractMetricsFlat`, and `buildMetricTree` on the
synthetic fixtures in `tests/fixtures/synthetic/` and diffs the result
against `baseline.json`.

This replaces `tests/parity/`, which compared JS output to a Python
baseline. The JS analyzer now emits more fields than the Python reference,
so the parity comparison was producing 800+ "extra" diffs that masked any
real regression. The Python source still lives in `reference/` as a record
of the original algorithm; the JS analyzer is the source of truth.

## Run

```bash
node tests/snapshot/run.mjs              # diff vs baseline, fail on drift
node tests/snapshot/run.mjs --update     # regenerate baseline.json
```

## When the snapshot fails

It means either:

1. **You changed analyzer output.** Inspect the diff, run with `--update`,
   review `git diff tests/snapshot/baseline.json`, and commit if intentional.
2. **You introduced a regression.** The diff names the exact path
   (e.g. `.stats.opportunities.cross_sell[3].premium`). Fix the analyzer.

Don't `--update` blindly. The baseline is the spec.

## Fixture inputs

The fixtures in `tests/fixtures/synthetic/` are deterministic outputs of
`tests/fixtures/generate.py`. They're checked in so the snapshot test runs
without Python. If you regenerate them, the baseline will change — that's
expected, but make sure it matches your intent before committing.
