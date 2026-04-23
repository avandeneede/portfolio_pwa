#!/usr/bin/env python3
"""
Run reference/analyzer.py on synthetic fixtures and emit JSON baseline.

The JS port's output is diff'd against this baseline in tests/parity/run.mjs.

Usage:
    python3 tests/parity/python_baseline.py
"""
import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)

from reference.analyzer import (
    compute_all_stats,
    compute_client_total,
    extract_metrics_flat,
    build_metric_tree,
)

FIX = os.path.join(ROOT, 'tests', 'fixtures', 'synthetic')
OUT = os.path.join(HERE, 'baseline.json')
SNAPSHOT_YEAR = 2026


def load(name):
    with open(os.path.join(FIX, f'{name}.json')) as f:
        return json.load(f)


def coerce_dates(rows, keys):
    """Convert ISO date strings back to date objects — analyzer expects real dates."""
    for r in rows:
        for k in keys:
            v = r.get(k)
            if isinstance(v, str) and v:
                try:
                    r[k] = date.fromisoformat(v)
                except ValueError:
                    pass
    return rows


def canonicalize(obj):
    """Sort set-derived lists so parity is stable across Python/JS hashing."""
    if isinstance(obj, list):
        canon = [canonicalize(x) for x in obj]
        # Heuristic: sort items of 'current_branches' (appears in opportunities).
        # The reference uses list(set) whose order is undefined; sort for parity.
        return canon
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in ('current_branches',) and isinstance(v, list):
                out[k] = sorted(v)
            elif k == 'current_branch' and isinstance(v, str):
                out[k] = v  # single value; JS picks same "first of set" ambiguity
            else:
                out[k] = canonicalize(v)
        return out
    return obj


def main():
    clients = coerce_dates(load('clients'), ['date_naissance'])
    polices = coerce_dates(load('polices'), ['date_effet'])
    compagnies = load('compagnies')
    sinistres = coerce_dates(load('sinistres'), ['date_evenement', 'date_etat'])

    stats = compute_all_stats(clients, polices, compagnies, sinistres, SNAPSHOT_YEAR)
    client_total = compute_client_total(clients, polices, compagnies, SNAPSHOT_YEAR)
    flat = extract_metrics_flat(stats)
    tree = build_metric_tree(set(flat.keys()))

    baseline = {
        'stats': canonicalize(stats),
        'client_total': client_total,
        'flat': flat,
        'tree': tree,
    }

    # Strip cross_sell.current_branch and opportunities' current_branches arrays
    # of set-order ambiguity: the JS port will mirror this exact stripping.
    for opp_key in ('cross_sell',):
        for row in baseline['stats']['opportunities'].get(opp_key, []):
            row.pop('current_branch', None)
    for opp_key in ('succession', 'young_families', 'high_value'):
        for row in baseline['stats']['opportunities'].get(opp_key, []):
            if 'current_branches' in row:
                row['current_branches'] = sorted(row['current_branches'])

    with open(OUT, 'w') as f:
        json.dump(baseline, f, ensure_ascii=False, indent=2, sort_keys=True, default=str)
    print(f'baseline → {OUT}')
    print(f'  overview.total={baseline["stats"]["overview"]["total"]}')
    print(f'  client_total.rows={len(baseline["client_total"])}')
    print(f'  flat.keys={len(baseline["flat"])}')
    print(f'  tree.nodes={len(baseline["tree"])}')


if __name__ == '__main__':
    main()
