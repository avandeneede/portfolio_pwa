# Parity tests

Proves the JS port of `reference/analyzer.py` matches the Python original on
deterministic synthetic fixtures.

## Run

```sh
python3 tests/fixtures/generate.py        # synthetic clients/polices/...
python3 tests/parity/python_baseline.py   # Python → baseline.json
node tests/parity/run.mjs                 # JS → diff against baseline
```

Exit code 0 = parity. Non-zero = at least one metric drifted.

## Coverage

| Section | Status |
|---|---|
| `compute_client_overview` | ✅ |
| `compute_geographic_profile` | ✅ |
| `compute_demographics` | ✅ |
| `compute_civil_social_status` | ✅ |
| `compute_data_quality` | ✅ |
| `compute_branches` | ✅ |
| `compute_subscription_index` | ✅ |
| `compute_policies_per_client` | ✅ |
| `compute_company_penetration` | ✅ |
| `compute_kpi_summary` | ✅ |
| `compute_opportunities` | ✅ |
| `compute_client_total` | ✅ |
| `extract_metrics_flat` | ✅ |
| `build_metric_tree` | ✅ |

M1 complete. Analyzer is fully ported and under parity-test contract.

## Canonicalization notes

Python's `set` iteration order is not portable across runs or interpreters.
Two analyzer outputs depend on set ordering:

- `opportunities.cross_sell[*].current_branch` — picks `list(branches)[0]`.
  Dropped in both canonicalization steps (baseline and harness) since there is
  no stable answer. Downstream UI must not rely on this field.
- `opportunities.{succession,young_families,high_value}[*].current_branches` —
  returned as `list(set)`. Sorted by both sides before diff.

The JS port emits these stably by JS-Set insertion order. Consumers that want
stable output should sort at read time, as the harness does.

## Why this exists

The original PLAN.md claimed `reference/analyzer.py` could drop into Pyodide
verbatim. The gstack engineering review found this false (config-file open at
import time, `hasattr(dn, 'year')` checks expect real `date` objects). D6 in
`PLAN.md` committed us to a JS port instead. This harness is the contract
that keeps the port honest — every section must match the Python original on
synthetic data before it ships.

## Why synthetic

The broker's real Excel files contain PII and can never enter this repo.
`tests/fixtures/generate.py` produces anonymized, deterministic data with the
same shape. Developers may place real fixtures under `private/fixtures/real/`
(gitignored) for deeper sanity checks locally — never commit them.
