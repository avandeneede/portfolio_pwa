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
from datetime import date, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)

from reference.analyzer import (
    compute_client_overview,
    compute_geographic_profile,
    compute_demographics,
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


def main():
    clients = coerce_dates(load('clients'), ['date_naissance'])
    polices = coerce_dates(load('polices'), ['date_effet'])

    # Mirror analyzer's "active-only for analysis sections" policy
    active_keys = {p.get('dossier_key') for p in polices if p.get('dossier_key')}
    active_clients = [c for c in clients if c.get('dossier_key') in active_keys]

    baseline = {
        'overview': compute_client_overview(clients, polices),
        'geographic': compute_geographic_profile(active_clients),
        'demographics': compute_demographics(active_clients, polices, SNAPSHOT_YEAR),
    }

    with open(OUT, 'w') as f:
        json.dump(baseline, f, ensure_ascii=False, indent=2, sort_keys=True, default=str)
    print(f'baseline → {OUT}')
    print(f'  overview.total={baseline["overview"]["total"]}')
    print(f'  geographic.rows={len(baseline["geographic"]["rows"])}')
    print(f'  demographics.unknown_age={baseline["demographics"]["unknown_age"]}')


if __name__ == '__main__':
    main()
