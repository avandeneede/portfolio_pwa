"""
Pure computation functions for portfolio analysis.
All functions receive plain data (lists of dicts), return results.
No DB access inside this module.
"""
import json
import os
import re
from collections import Counter, defaultdict


def load_branch_mapping(config_path=None):
    """Load branch mapping from JSON config file."""
    if config_path is None:
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'branch_mapping.json')
    with open(config_path) as f:
        mapping = json.load(f)
    # Build reverse lookup: type_police_value -> branch_code
    reverse = {}
    for code, values in mapping.items():
        for v in values:
            reverse[v.lower()] = code
    return mapping, reverse


BRANCH_MAPPING, BRANCH_REVERSE = load_branch_mapping()
BRANCH_CODES = list(BRANCH_MAPPING.keys())


def get_branch_code(type_police):
    """Map a type_police value to a branch code. Unknown -> 'DIV'."""
    if not type_police:
        return 'DIV'
    return BRANCH_REVERSE.get(str(type_police).strip().lower(), 'DIV')


def normalize_address(rue):
    """Normalize street address for comparison."""
    if not rue:
        return ''
    s = str(rue).strip().lower()
    s = re.sub(r'[,.\-/]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    # Normalize common abbreviations
    s = re.sub(r'\brué?\b', 'rue', s)
    s = re.sub(r'\bstr\b', 'straat', s)
    s = re.sub(r'\bav\b', 'avenue', s)
    s = re.sub(r'\bbd\b', 'boulevard', s)
    return s


# --- Section 1: Client Overview ---

def compute_client_overview(clients, polices):
    """Compute Particuliers vs Entreprises split.

    Args:
        clients: list of client dicts
        polices: list of police dicts

    Returns:
        dict with overview stats
    """
    total = len(clients)
    if total == 0:
        return {'total': 0, 'particuliers': 0, 'entreprises': 0, 'pct_particuliers': 0,
                'pct_entreprises': 0, 'active_clients': 0, 'clients_sans_police': 0}

    particuliers = sum(1 for c in clients if str(c.get('physique_morale', '')).strip().lower() in ('p', 'physique', 'personne physique', ''))
    entreprises = total - particuliers

    # Active clients = those with at least 1 policy
    client_keys_with_polices = {p.get('dossier_key') for p in polices if p.get('dossier_key')}

    active_p = 0
    active_e = 0
    for c in clients:
        is_p = str(c.get('physique_morale', '')).strip().lower() in ('p', 'physique', 'personne physique', '')
        has_police = c.get('dossier_key') in client_keys_with_polices
        if has_police:
            if is_p:
                active_p += 1
            else:
                active_e += 1

    active = active_p + active_e
    sans_police = total - active
    sans_police_p = particuliers - active_p
    sans_police_e = entreprises - active_e

    return {
        'total': total,
        'particuliers': particuliers,
        'entreprises': entreprises,
        'pct_particuliers': round(particuliers / total * 100, 1) if total else 0,
        'pct_entreprises': round(entreprises / total * 100, 1) if total else 0,
        'active_clients': active,
        'active_particuliers': active_p,
        'active_entreprises': active_e,
        'pct_active_particuliers': round(active_p / active * 100, 1) if active else 0,
        'pct_active_entreprises': round(active_e / active * 100, 1) if active else 0,
        'clients_sans_police': sans_police,
        'sans_police_particuliers': sans_police_p,
        'sans_police_entreprises': sans_police_e,
    }


# --- Section 2: Geographic Profile ---

def compute_geographic_profile(clients, cumul_threshold=70.0):
    """Compute ranked postal code table with cumulative percentages."""
    total = len(clients)
    if total == 0:
        return {'rows': [], 'zone_count': 0, 'zone_pct': 0, 'hors_zone_count': 0, 'hors_zone_pct': 0}

    # Count by postal code
    cp_counts = Counter()
    cp_localite = {}
    for c in clients:
        cp = str(c.get('code_postal', '')).strip()
        if cp and cp.lower() not in ('none', ''):
            cp_counts[cp] += 1
            if cp not in cp_localite:
                loc = str(c.get('localite', '')).strip()
                if loc and loc.lower() != 'none':
                    cp_localite[cp] = loc

    # Sort by count descending
    ranked = sorted(cp_counts.items(), key=lambda x: (-x[1], x[0]))

    rows = []
    cumul = 0
    zone_count = 0
    zone_threshold_reached = False

    for cp, count in ranked:
        pct = round(count / total * 100, 1)
        cumul += pct
        rows.append({
            'code_postal': cp,
            'localite': cp_localite.get(cp, ''),
            'count': count,
            'pct': pct,
            'cumul_pct': round(cumul, 1),
        })
        if not zone_threshold_reached:
            zone_count += count
            if cumul >= cumul_threshold:
                zone_threshold_reached = True

    if not zone_threshold_reached:
        zone_count = total

    return {
        'rows': rows,
        'zone_count': zone_count,
        'zone_pct': round(zone_count / total * 100, 1),
        'hors_zone_count': total - zone_count,
        'hors_zone_pct': round((total - zone_count) / total * 100, 1),
    }


# --- Section 3: Demographics ---

def compute_demographics(clients, polices, snapshot_year):
    """Compute gender split and age brackets."""
    total = len(clients)
    if total == 0:
        return {'gender': {}, 'age_brackets': [], 'total': 0}

    # Gender split
    gender_counts = Counter()
    for c in clients:
        sexe = str(c.get('sexe', '')).strip().upper()
        if sexe in ('M', 'MASCULIN'):
            gender_counts['M'] += 1
        elif sexe in ('F', 'FÉMININ', 'FEMININ'):
            gender_counts['F'] += 1
        else:
            gender_counts['Inconnu'] += 1

    gender = {k: {'count': v, 'pct': round(v / total * 100, 1)} for k, v in gender_counts.items()}

    # Age brackets
    brackets_def = [(0, 19), (20, 29), (30, 39), (40, 49), (50, 59), (60, 69), (70, 999)]
    bracket_counts = {f"{lo}-{hi if hi < 999 else '+'}": 0 for lo, hi in brackets_def}
    bracket_labels = [f"{lo}-{hi if hi < 999 else '+'}" for lo, hi in brackets_def]
    unknown_age = 0

    # Build policy count per age bracket
    client_keys_polices = Counter(p.get('dossier_key') for p in polices if p.get('dossier_key'))
    bracket_policy_counts = {label: 0 for label in bracket_labels}

    for c in clients:
        dn = c.get('date_naissance')
        if dn is None:
            unknown_age += 1
            continue
        try:
            if hasattr(dn, 'year'):
                age = snapshot_year - dn.year
            else:
                unknown_age += 1
                continue
        except (TypeError, AttributeError):
            unknown_age += 1
            continue

        if age < 0:
            age = 0

        for lo, hi in brackets_def:
            label = f"{lo}-{hi if hi < 999 else '+'}"
            if lo <= age <= hi:
                bracket_counts[label] += 1
                # Add policy count for this client
                dk = c.get('dossier_key')
                if dk and dk in client_keys_polices:
                    bracket_policy_counts[label] += client_keys_polices[dk]
                break

    age_brackets = []
    for label in bracket_labels:
        age_brackets.append({
            'label': label,
            'client_count': bracket_counts[label],
            'policy_count': bracket_policy_counts[label],
            'pct': round(bracket_counts[label] / total * 100, 1) if total else 0,
        })

    return {
        'gender': gender,
        'age_brackets': age_brackets,
        'unknown_age': unknown_age,
        'total': total,
    }


# --- Section 4: Civil & Social Status ---

def compute_civil_social_status(clients):
    """Compute marital status and social/professional status distributions."""
    total = len(clients)
    if total == 0:
        return {'civil_status': [], 'social_status': [], 'total': 0}

    civil_counts = Counter()
    social_counts = Counter()

    for c in clients:
        ec = str(c.get('etat_civil', '')).strip()
        if ec and ec.lower() not in ('none', ''):
            civil_counts[ec] += 1
        else:
            civil_counts['Inconnu'] += 1

        ss = str(c.get('statut_social', '')).strip()
        if ss and ss.lower() not in ('none', ''):
            social_counts[ss] += 1
        else:
            social_counts['Inconnu'] += 1

    civil_status = sorted(
        [{'label': k, 'count': v, 'pct': round(v / total * 100, 1)} for k, v in civil_counts.items()],
        key=lambda x: -x['count']
    )
    social_status = sorted(
        [{'label': k, 'count': v, 'pct': round(v / total * 100, 1)} for k, v in social_counts.items()],
        key=lambda x: -x['count']
    )

    return {'civil_status': civil_status, 'social_status': social_status, 'total': total}


# --- Section 5: Data Quality ---

def compute_data_quality(clients):
    """Compute % missing/unknown per field."""
    total = len(clients)
    if total == 0:
        return {'fields': [], 'total': 0}

    fields_to_check = [
        ('sexe', 'Sexe'),
        ('date_naissance', 'Âge'),
        ('statut_social', 'Statut social'),
        ('etat_civil', 'État civil'),
        ('telephone', 'Téléphone'),
        ('email', 'E-mail'),
    ]

    fields = []
    for field_key, field_label in fields_to_check:
        known = 0
        for c in clients:
            val = c.get(field_key)
            if val is not None and str(val).strip() not in ('', 'None', 'none'):
                known += 1
        missing = total - known
        fields.append({
            'key': field_key,
            'label': field_label,
            'known': known,
            'missing': missing,
            'pct_missing': round(missing / total * 100, 1) if total else 0,
            'critical': missing / total > 0.5 if total else False,
        })

    return {'fields': fields, 'total': total}


# --- Section 6: Insurance Branches ---

def compute_branches(polices):
    """Compute IARD/Vie/Placement/Crédit breakdown and per-branch policy counts."""
    total = len(polices)
    if total == 0:
        return {'domains': [], 'branches': [], 'total': 0}

    domain_counts = Counter()
    branch_counts = Counter()

    for p in polices:
        domaine = str(p.get('domaine', '')).strip()
        if domaine:
            domain_counts[domaine] += 1

        tp = p.get('type_police', '')
        branch = get_branch_code(tp)
        branch_counts[branch] += 1

    domains = sorted(
        [{'label': k, 'count': v, 'pct': round(v / total * 100, 1)} for k, v in domain_counts.items()],
        key=lambda x: -x['count']
    )
    branches = sorted(
        [{'code': k, 'count': v, 'pct': round(v / total * 100, 1)} for k, v in branch_counts.items()],
        key=lambda x: -x['count']
    )

    return {'domains': domains, 'branches': branches, 'total': total}


# --- Section 7: Subscription Index ---

def compute_subscription_index(clients, polices):
    """For each branch: how many clients hold at least 1 policy in that branch."""
    if not clients or not polices:
        return {'branches': [], 'active_clients': 0}

    client_keys_with_polices = {p.get('dossier_key') for p in polices if p.get('dossier_key')}
    active_clients = sum(1 for c in clients if c.get('dossier_key') in client_keys_with_polices)

    # Group polices by client and branch
    client_branches = defaultdict(set)
    for p in polices:
        dk = p.get('dossier_key')
        if dk:
            branch = get_branch_code(p.get('type_police', ''))
            client_branches[dk].add(branch)

    # Count clients per branch
    branch_client_counts = Counter()
    for dk, branches in client_branches.items():
        for b in branches:
            branch_client_counts[b] += 1

    branches = sorted(
        [{
            'code': code,
            'client_count': count,
            'penetration': round(count / active_clients * 100, 1) if active_clients else 0,
        } for code, count in branch_client_counts.items()],
        key=lambda x: -x['client_count']
    )

    return {'branches': branches, 'active_clients': active_clients}


# --- Section 8: Policies Per Client ---

def compute_policies_per_client(clients, polices):
    """Distribution of policy count per client."""
    if not clients:
        return {'distribution': [], 'mono_policy': [], 'total_clients': 0}

    # Count polices per client
    polices_per_client = Counter()
    for p in polices:
        dk = p.get('dossier_key')
        if dk:
            polices_per_client[dk] += 1

    # Distribution
    count_dist = Counter()
    for c in clients:
        dk = c.get('dossier_key')
        n = polices_per_client.get(dk, 0)
        if n == 0:
            count_dist['0'] += 1
        elif n >= 5:
            count_dist['5+'] += 1
        else:
            count_dist[str(n)] += 1

    distribution = []
    for label in ['0', '1', '2', '3', '4', '5+']:
        distribution.append({'label': label, 'count': count_dist.get(label, 0)})

    # Mono-policy clients: breakdown by branch
    # Build index: dossier_key -> list of polices for O(1) lookup
    polices_by_dk = defaultdict(list)
    for p in polices:
        dk = p.get('dossier_key')
        if dk:
            polices_by_dk[dk].append(p)

    mono_clients = defaultdict(list)
    for c in clients:
        dk = c.get('dossier_key')
        if polices_per_client.get(dk, 0) == 1:
            client_polices = polices_by_dk.get(dk, [])
            if client_polices:
                branch = get_branch_code(client_polices[0].get('type_police', ''))
                mono_clients[branch].append(c)

    mono_policy = sorted(
        [{'branch': k, 'count': len(v)} for k, v in mono_clients.items()],
        key=lambda x: -x['count']
    )

    return {
        'distribution': distribution,
        'mono_policy': mono_policy,
        'total_clients': len(clients),
    }


# --- Section 9: Company Penetration ---

def compute_company_penetration(polices):
    """All insurers ranked by policy count."""
    total = len(polices)
    if total == 0:
        return {'companies': [], 'total': 0}

    company_counts = Counter()
    for p in polices:
        comp = str(p.get('compagnie', '')).strip()
        if comp and comp.lower() not in ('none', ''):
            company_counts[comp] += 1

    companies = sorted(
        [{'name': k, 'count': v, 'pct': round(v / total * 100, 1)} for k, v in company_counts.items()],
        key=lambda x: -x['count']
    )

    return {'companies': companies, 'total': total}


# --- Section 10: KPI Summary ---

def compute_kpi_summary(clients, polices, compagnie_polices, sinistres, snapshot_year):
    """Compute master KPI table."""
    total_clients = len(clients)
    total_polices = len(polices)

    client_keys_with_polices = {p.get('dossier_key') for p in polices if p.get('dossier_key')}
    active_clients = sum(1 for c in clients if c.get('dossier_key') in client_keys_with_polices)

    # Count polices per client
    polices_per_client = Counter(p.get('dossier_key') for p in polices if p.get('dossier_key'))

    avg_polices = round(total_polices / active_clients, 2) if active_clients else 0

    # Total premium and commission
    total_premium = sum(cp.get('prime_totale_annuelle', 0) or 0 for cp in compagnie_polices)
    total_commission = sum(cp.get('commission_annuelle', 0) or 0 for cp in compagnie_polices)
    avg_premium_per_client = round(total_premium / active_clients, 2) if active_clients else 0
    avg_commission_per_client = round(total_commission / active_clients, 2) if active_clients else 0

    # Mono-policy count
    mono_policy = sum(1 for dk, count in polices_per_client.items() if count == 1)

    # Clients with sinistres
    clients_with_sinistres = len({s.get('dossier_key') for s in sinistres if s.get('dossier_key')})

    return {
        'total_clients': total_clients,
        'active_clients': active_clients,
        'clients_sans_police': total_clients - active_clients,
        'total_polices': total_polices,
        'avg_polices_per_client': avg_polices,
        'mono_policy_clients': mono_policy,
        'total_premium': round(total_premium, 2),
        'total_commission': round(total_commission, 2),
        'avg_premium_per_client': avg_premium_per_client,
        'avg_commission_per_client': avg_commission_per_client,
        'total_sinistres': len(sinistres),
        'clients_with_sinistres': clients_with_sinistres,
        'snapshot_year': snapshot_year,
    }


# --- Section 11: Opportunities ---

def compute_opportunities(clients, polices, compagnie_polices, snapshot_year):
    """Compute actionable insights: cross-sell, data quality, succession, young families, high-value."""
    if not clients:
        return {'cross_sell': [], 'data_quality_cleanup': [], 'succession': [],
                'young_families': [], 'high_value': []}

    polices_per_client = Counter()
    client_branches = defaultdict(set)
    client_domains = defaultdict(set)
    for p in polices:
        dk = p.get('dossier_key')
        if dk:
            polices_per_client[dk] += 1
            branch = get_branch_code(p.get('type_police', ''))
            client_branches[dk].add(branch)
            domaine = str(p.get('domaine', '')).strip()
            if domaine:
                client_domains[dk].add(domaine.lower())

    # Premium per client from compagnie_polices
    client_premium = Counter()
    for cp in compagnie_polices:
        dk = cp.get('dossier_key')
        if dk:
            client_premium[dk] += (cp.get('prime_totale_annuelle') or 0)

    client_keys_with_polices = {p.get('dossier_key') for p in polices if p.get('dossier_key')}

    # 1. Cross-sell: mono-policy clients
    cross_sell = []
    for c in clients:
        dk = c.get('dossier_key')
        if polices_per_client.get(dk, 0) == 1:
            branches = client_branches.get(dk, set())
            cross_sell.append({
                'dossier_key': dk,
                'nom': c.get('nom', ''),
                'telephone': c.get('telephone', ''),
                'email': c.get('email', ''),
                'current_branch': list(branches)[0] if branches else '',
                'code_postal': c.get('code_postal', ''),
            })

    # 2. Data quality cleanup: clients missing key fields
    data_quality_cleanup = []
    key_fields = ['sexe', 'date_naissance', 'telephone', 'email', 'etat_civil', 'statut_social']
    for c in clients:
        missing = []
        for f in key_fields:
            val = c.get(f)
            if val is None or str(val).strip() in ('', 'None', 'none'):
                missing.append(f)
        if missing:
            data_quality_cleanup.append({
                'dossier_key': c.get('dossier_key', ''),
                'nom': c.get('nom', ''),
                'missing_fields': missing,
                'missing_count': len(missing),
            })

    # 3. Succession: clients 60+ without Vie or Placement products
    succession = []
    for c in clients:
        dn = c.get('date_naissance')
        if dn is None or not hasattr(dn, 'year'):
            continue
        age = snapshot_year - dn.year
        if age >= 60:
            dk = c.get('dossier_key')
            branches = client_branches.get(dk, set())
            if 'VIE' not in branches and 'PLA' not in branches:
                succession.append({
                    'dossier_key': dk,
                    'nom': c.get('nom', ''),
                    'age': age,
                    'telephone': c.get('telephone', ''),
                    'email': c.get('email', ''),
                    'current_branches': list(branches),
                })

    # 4. Young families without life insurance: ages 25-45 with IARD but no Vie
    young_families = []
    for c in clients:
        dn = c.get('date_naissance')
        if dn is None or not hasattr(dn, 'year'):
            continue
        age = snapshot_year - dn.year
        if 25 <= age <= 45:
            dk = c.get('dossier_key')
            if dk not in client_keys_with_polices:
                continue
            branches = client_branches.get(dk, set())
            domains = client_domains.get(dk, set())
            # Has IARD but no life insurance
            has_iard = any(d in ('iard', 'incendie, accidents et risques divers') for d in domains)
            has_vie = 'VIE' in branches
            if has_iard and not has_vie:
                young_families.append({
                    'dossier_key': dk,
                    'nom': c.get('nom', ''),
                    'age': age,
                    'telephone': c.get('telephone', ''),
                    'email': c.get('email', ''),
                    'current_branches': list(branches),
                })

    # 5. High-value clients with low coverage: top premium payers with few policies
    high_value = []
    if client_premium:
        # Find clients paying above-average premium but with <= 2 policies
        avg_premium = sum(client_premium.values()) / len(client_premium) if client_premium else 0
        threshold = avg_premium * 1.5
        for c in clients:
            dk = c.get('dossier_key')
            premium = client_premium.get(dk, 0)
            n_pol = polices_per_client.get(dk, 0)
            if premium >= threshold and 1 <= n_pol <= 2:
                branches = client_branches.get(dk, set())
                high_value.append({
                    'dossier_key': dk,
                    'nom': c.get('nom', ''),
                    'premium': round(premium, 2),
                    'n_policies': n_pol,
                    'telephone': c.get('telephone', ''),
                    'email': c.get('email', ''),
                    'current_branches': list(branches),
                })
        high_value.sort(key=lambda x: -x['premium'])

    return {
        'cross_sell': cross_sell,
        'data_quality_cleanup': sorted(data_quality_cleanup, key=lambda x: -x['missing_count']),
        'succession': succession,
        'young_families': young_families,
        'high_value': high_value,
    }


# --- CLIENT TOTAL Generation ---

def compute_client_total(clients, polices, compagnie_polices, snapshot_year):
    """Generate CLIENT TOTAL enriched client data.

    Returns list of dicts, one per client, with all 45 columns.
    """
    if not clients:
        return []

    # Index polices by dossier_key
    polices_by_dk = defaultdict(list)
    for p in polices:
        dk = p.get('dossier_key')
        if dk:
            polices_by_dk[dk].append(p)

    # Index compagnie_polices by dossier_key
    comp_by_dk = defaultdict(list)
    for cp in compagnie_polices:
        dk = cp.get('dossier_key')
        if dk:
            comp_by_dk[dk].append(cp)

    # Build address index for #POL Adres
    address_polices = defaultdict(set)
    for p in polices:
        dk = p.get('dossier_key')
        if dk:
            address_polices[dk].add(p.get('police', ''))

    # Group clients by normalized address
    client_address = {}
    address_groups = defaultdict(set)
    for c in clients:
        dk = c.get('dossier_key')
        cp = str(c.get('code_postal', '')).strip()
        rue = normalize_address(c.get('rue', ''))
        addr_key = f"{cp}|{rue}" if cp and rue else None
        client_address[dk] = addr_key
        if addr_key:
            address_groups[addr_key].add(dk)

    # Build set of active client keys (those with at least one policy)
    active_keys = set(polices_by_dk.keys())

    result = []
    for c in clients:
        dk = c.get('dossier_key')

        # Skip clients without policies
        if dk not in active_keys:
            continue

        # Nclient: dossier/sous_dossier as integer
        dossier = str(c.get('dossier', '0')).strip()
        sous_dossier = str(c.get('sous_dossier', '00')).strip()
        try:
            nclient = int(dossier) * 100 + int(sous_dossier)
        except (ValueError, TypeError):
            nclient = 0

        # Age
        dn = c.get('date_naissance')
        age = None
        if dn and hasattr(dn, 'year'):
            age = snapshot_year - dn.year

        # Type PE
        pm = str(c.get('physique_morale', '')).strip().lower()
        type_pe = 'P' if pm in ('p', 'physique', 'personne physique', '') else 'E'

        # #POL
        client_polices = polices_by_dk.get(dk, [])
        n_pol = len(client_polices)

        # #POL Adres: count of polices at same address
        addr_key = client_address.get(dk)
        if addr_key:
            same_addr_dks = address_groups.get(addr_key, set())
            pol_adres = sum(len(polices_by_dk.get(other_dk, [])) for other_dk in same_addr_dks)
        else:
            pol_adres = n_pol

        # COM IARD: sum of commission_annuelle where domaine is NOT "Vie et placements"
        # IARD = Incendie, Accidents, Risques Divers = everything except Vie
        client_comps = comp_by_dk.get(dk, [])
        if client_comps:
            com_iard = sum(
                (cp.get('commission_annuelle') or 0)
                for cp in client_comps
                if str(cp.get('domaine', '')).strip().lower() not in ('vie et placements',)
            )
        else:
            com_iard = None

        # Branch flags
        branch_flags = {code: '' for code in BRANCH_CODES}
        for p in client_polices:
            branch = get_branch_code(p.get('type_police', ''))
            branch_flags[branch] = 'x'

        row = {
            'dossier_key': dk,
            'nclient': nclient,
            'dossier': c.get('dossier', ''),
            'sous_dossier': c.get('sous_dossier', ''),
            'titre': c.get('titre', ''),
            'nom': c.get('nom', ''),
            'nom_conjoint': c.get('nom_conjoint', ''),
            'rue': c.get('rue', ''),
            'pays': c.get('pays', ''),
            'code_postal': c.get('code_postal', ''),
            'localite': c.get('localite', ''),
            'age': age,
            'langue': c.get('langue', ''),
            'telephone': c.get('telephone', ''),
            'description_telephone': c.get('description_telephone', ''),
            'fax': c.get('fax', ''),
            'email': c.get('email', ''),
            'profession': c.get('profession', ''),
            'physique_morale': c.get('physique_morale', ''),
            'etat_civil': c.get('etat_civil', ''),
            'type_pe': type_pe,
            'n_pol': n_pol,
            'pol_adres': pol_adres,
            'com_iard': round(com_iard, 2) if com_iard else None,
        }

        # Add branch flags
        for code in BRANCH_CODES:
            row[code] = branch_flags[code]

        result.append(row)

    return result


# --- Compute All Stats ---

def compute_all_stats(clients, polices, compagnie_polices, sinistres, snapshot_year):
    """Compute all 10 report sections. Returns dict of section results.

    Analysis sections use only active clients (those with at least one policy).
    Clients without policies are tracked in the overview and KPI summary but
    excluded from demographic, geographic, and other breakdowns.
    """
    # Active clients = those with at least one policy
    active_keys = {p.get('dossier_key') for p in polices if p.get('dossier_key')}
    active_clients = [c for c in clients if c.get('dossier_key') in active_keys]

    return {
        # Overview & KPI use ALL clients to report the full picture
        'overview': compute_client_overview(clients, polices),
        'kpi_summary': compute_kpi_summary(clients, polices, compagnie_polices, sinistres, snapshot_year),
        # All analysis sections use active clients only
        'geographic': compute_geographic_profile(active_clients),
        'demographics': compute_demographics(active_clients, polices, snapshot_year),
        'civil_social': compute_civil_social_status(active_clients),
        'data_quality': compute_data_quality(active_clients),
        'branches': compute_branches(polices),
        'subscription': compute_subscription_index(active_clients, polices),
        'policies_per_client': compute_policies_per_client(active_clients, polices),
        'companies': compute_company_penetration(polices),
        'opportunities': compute_opportunities(active_clients, polices, compagnie_polices, snapshot_year),
    }


# --- Metric Extraction for Comparator ---

def extract_metrics_flat(stats):
    """Extract all scalar metrics from stats dict into a flat key-value map.

    Used by the evolution/comparator page to build time-series for any metric.
    Keys use dot-notation: 'section.metric' or 'section.sub.metric'.
    """
    metrics = {}

    # Overview
    ov = stats.get('overview', {})
    metrics['overview.total'] = ov.get('total', 0)
    metrics['overview.particuliers'] = ov.get('particuliers', 0)
    metrics['overview.entreprises'] = ov.get('entreprises', 0)
    metrics['overview.active_clients'] = ov.get('active_clients', 0)
    metrics['overview.clients_sans_police'] = ov.get('clients_sans_police', 0)

    # KPI Summary
    kpi = stats.get('kpi_summary', {})
    metrics['kpi.total_polices'] = kpi.get('total_polices', 0)
    metrics['kpi.avg_polices_per_client'] = kpi.get('avg_polices_per_client', 0)
    metrics['kpi.mono_policy_clients'] = kpi.get('mono_policy_clients', 0)
    metrics['kpi.total_premium'] = kpi.get('total_premium', 0)
    metrics['kpi.total_commission'] = kpi.get('total_commission', 0)
    metrics['kpi.avg_premium_per_client'] = kpi.get('avg_premium_per_client', 0)
    metrics['kpi.avg_commission_per_client'] = kpi.get('avg_commission_per_client', 0)
    metrics['kpi.total_sinistres'] = kpi.get('total_sinistres', 0)
    metrics['kpi.clients_with_sinistres'] = kpi.get('clients_with_sinistres', 0)

    # Geographic
    geo = stats.get('geographic', {})
    metrics['geographic.zone_count'] = geo.get('zone_count', 0)
    metrics['geographic.hors_zone_count'] = geo.get('hors_zone_count', 0)

    # Demographics — gender
    demo = stats.get('demographics', {})
    for gender_key, gender_data in demo.get('gender', {}).items():
        count = gender_data.get('count', 0) if isinstance(gender_data, dict) else gender_data
        metrics[f'demographics.gender.{gender_key}'] = count

    # Demographics — age brackets
    for bracket in demo.get('age_brackets', []):
        label = bracket.get('label', '')
        metrics[f'demographics.age.{label}.clients'] = bracket.get('client_count', 0)
        metrics[f'demographics.age.{label}.policies'] = bracket.get('policy_count', 0)

    # Branches — per code
    branches = stats.get('branches', {})
    for b in branches.get('branches', []):
        metrics[f'branches.{b.get("code", "")}'] = b.get('count', 0)
    # Branches — per domain
    for d in branches.get('domains', []):
        metrics[f'branches.domain.{d.get("label", "")}'] = d.get('count', 0)

    # Subscription — penetration per branch
    sub = stats.get('subscription', {})
    for b in sub.get('branches', []):
        metrics[f'subscription.{b.get("code", "")}'] = b.get('penetration', 0)

    # Companies — count per company
    companies = stats.get('companies', {})
    for comp in companies.get('companies', []):
        metrics[f'companies.{comp.get("name", "")}'] = comp.get('count', 0)

    # Data quality — % missing per field
    dq = stats.get('data_quality', {})
    for field in dq.get('fields', []):
        metrics[f'data_quality.{field.get("key", "")}'] = field.get('pct_missing', 0)

    # Policies per client — distribution
    ppc = stats.get('policies_per_client', {})
    for d in ppc.get('distribution', []):
        metrics[f'policies.distribution.{d.get("label", "")}'] = d.get('count', 0)

    return metrics


def build_metric_tree(all_metrics_keys):
    """Build a hierarchical metric tree from the union of all metric keys.

    Args:
        all_metrics_keys: set of all metric key strings across all snapshots

    Returns:
        list of tree nodes: [{id, label, icon, children: [{id, label}]}]
    """
    # Static sections (always present)
    tree = [
        {
            'id': 'overview',
            'label': 'Overview',
            'icon': 'bi-pie-chart',
            'children': [
                {'id': 'overview.total', 'label': 'Total Clients'},
                {'id': 'overview.particuliers', 'label': 'Particuliers'},
                {'id': 'overview.entreprises', 'label': 'Entreprises'},
                {'id': 'overview.active_clients', 'label': 'Active Clients'},
                {'id': 'overview.clients_sans_police', 'label': 'Clients sans Police'},
            ]
        },
        {
            'id': 'kpi',
            'label': 'KPI',
            'icon': 'bi-speedometer2',
            'children': [
                {'id': 'kpi.total_polices', 'label': 'Total Policies'},
                {'id': 'kpi.avg_polices_per_client', 'label': 'Avg Policies/Client'},
                {'id': 'kpi.mono_policy_clients', 'label': 'Mono-policy Clients'},
                {'id': 'kpi.total_premium', 'label': 'Total Premium'},
                {'id': 'kpi.total_commission', 'label': 'Total Commission'},
                {'id': 'kpi.avg_premium_per_client', 'label': 'Avg Premium/Client'},
                {'id': 'kpi.avg_commission_per_client', 'label': 'Avg Commission/Client'},
                {'id': 'kpi.total_sinistres', 'label': 'Total Claims'},
                {'id': 'kpi.clients_with_sinistres', 'label': 'Clients with Claims'},
            ]
        },
        {
            'id': 'geographic',
            'label': 'Geographic',
            'icon': 'bi-geo-alt',
            'children': [
                {'id': 'geographic.zone_count', 'label': 'Zone Count'},
                {'id': 'geographic.hors_zone_count', 'label': 'Hors Zone Count'},
            ]
        },
    ]

    # Demographics — gender (dynamic children from keys)
    gender_children = []
    for k in sorted(all_metrics_keys):
        if k.startswith('demographics.gender.'):
            label = k.split('.')[-1]
            gender_children.append({'id': k, 'label': label})

    # Demographics — age brackets (dynamic)
    age_children = []
    age_labels_seen = set()
    for k in sorted(all_metrics_keys):
        if k.startswith('demographics.age.'):
            parts = k.split('.')
            # e.g. demographics.age.20-29.clients
            age_label = parts[2]
            suffix = parts[3] if len(parts) > 3 else 'clients'
            display = f'{age_label} ({suffix})'
            age_children.append({'id': k, 'label': display})

    demo_children = gender_children + age_children
    if demo_children:
        tree.append({
            'id': 'demographics',
            'label': 'Demographics',
            'icon': 'bi-people',
            'children': demo_children,
        })

    # Branches — per code (dynamic)
    branch_children = []
    domain_children = []
    for k in sorted(all_metrics_keys):
        if k.startswith('branches.domain.'):
            label = k.split('branches.domain.')[1]
            domain_children.append({'id': k, 'label': label})
        elif k.startswith('branches.'):
            code = k.split('branches.')[1]
            branch_children.append({'id': k, 'label': code})
    if branch_children or domain_children:
        tree.append({
            'id': 'branches',
            'label': 'Branches',
            'icon': 'bi-diagram-3',
            'children': domain_children + branch_children,
        })

    # Subscription — per branch penetration (dynamic)
    sub_children = []
    for k in sorted(all_metrics_keys):
        if k.startswith('subscription.'):
            code = k.split('subscription.')[1]
            sub_children.append({'id': k, 'label': f'{code} (%)'})
    if sub_children:
        tree.append({
            'id': 'subscription',
            'label': 'Subscription Index',
            'icon': 'bi-bar-chart-steps',
            'children': sub_children,
        })

    # Companies (dynamic)
    company_children = []
    for k in sorted(all_metrics_keys):
        if k.startswith('companies.'):
            name = k.split('companies.')[1]
            company_children.append({'id': k, 'label': name})
    if company_children:
        tree.append({
            'id': 'companies',
            'label': 'Companies',
            'icon': 'bi-building',
            'children': company_children,
        })

    # Data quality (dynamic)
    dq_children = []
    for k in sorted(all_metrics_keys):
        if k.startswith('data_quality.'):
            field = k.split('data_quality.')[1]
            dq_children.append({'id': k, 'label': f'{field} (% missing)'})
    if dq_children:
        tree.append({
            'id': 'data_quality',
            'label': 'Data Quality',
            'icon': 'bi-clipboard-check',
            'children': dq_children,
        })

    # Policies distribution (dynamic)
    pol_children = []
    for k in sorted(all_metrics_keys):
        if k.startswith('policies.distribution.'):
            label = k.split('policies.distribution.')[1]
            pol_children.append({'id': k, 'label': f'{label} policies'})
    if pol_children:
        tree.append({
            'id': 'policies',
            'label': 'Policies per Client',
            'icon': 'bi-file-earmark-text',
            'children': pol_children,
        })

    return tree
