#!/usr/bin/env python3
"""
Synthetic fixture generator for parity tests.

Produces deterministic, anonymized clients/polices/compagnies/sinistres data
shaped like the broker's real Excel exports. NO real data is used.

Usage:
    python3 tests/fixtures/generate.py

Writes:
    tests/fixtures/synthetic/clients.json
    tests/fixtures/synthetic/polices.json
    tests/fixtures/synthetic/compagnies.json
    tests/fixtures/synthetic/sinistres.json

Determinism: seeded RNG + sorted iteration → same output every run.
"""
import json
import os
import random
from datetime import date, timedelta

SEED = 20260423
N_CLIENTS = 300          # ~1% of a real broker portfolio, enough for real coverage
MONO_POLICY_RATE = 0.25  # ~25% of clients have exactly one policy
SANS_POLICE_RATE = 0.08  # ~8% of clients have no policies

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'synthetic')
CONFIG = os.path.join(os.path.dirname(HERE), '..', 'config', 'branch_mapping.json')

# Anonymized Belgian-shape data
POSTAL_CODES = [
    ('9000', 'Gent'), ('9030', 'Mariakerke'), ('9031', 'Drongen'),
    ('9050', 'Ledeberg'), ('9051', 'Sint-Denijs-Westrem'), ('9052', 'Zwijnaarde'),
    ('9800', 'Deinze'), ('9820', 'Merelbeke'), ('9830', 'Sint-Martens-Latem'),
    ('9840', 'De Pinte'), ('1000', 'Bruxelles'), ('2000', 'Antwerpen'),
    ('4000', 'Liège'), ('5000', 'Namur'), ('6000', 'Charleroi'),
]
# Made-up surnames, not matched to any real person
SURNAMES = ['Janssens', 'Peeters', 'Maes', 'Jacobs', 'Mertens', 'Willems',
            'Claes', 'Goossens', 'Wouters', 'De Smet', 'Dubois', 'Lambert',
            'Martin', 'Dupont', 'Simon', 'Laurent', 'Lefevre', 'Leclercq']
FIRST_NAMES = ['Jan', 'Piet', 'Marie', 'Anne', 'Jean', 'Sophie', 'Marc',
               'Caroline', 'Luc', 'Isabelle', 'Paul', 'Nathalie']
COMPANIES = ['AXA', 'Allianz', 'Baloise', 'AG Insurance', 'Ethias',
             'KBC Verzekeringen', 'P&V', 'DKV', 'Vivium', 'Generali']
CIVIL_STATUSES = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf(ve)', 'Cohabitant(e) légal(e)']
SOCIAL_STATUSES = ['Salarié', 'Indépendant', 'Fonctionnaire', 'Retraité', 'Étudiant', 'Sans profession']
DOMAINS = ['IARD', 'Vie et placements', 'Placements', 'Crédit']
PROFESSIONS = ['Enseignant', 'Ingénieur', 'Médecin', 'Commerçant', 'Employé',
               'Retraité', 'Ouvrier', 'Cadre', 'Avocat', 'Agriculteur']


def load_branches():
    with open(CONFIG) as f:
        return json.load(f)


def iso(d):
    return d.isoformat() if d else None


def gen_clients(rng, branches):
    clients = []
    for i in range(N_CLIENTS):
        dossier = f'{1000 + i:06d}'
        sous_dossier = '00'
        dossier_key = f'{dossier}/{sous_dossier}'
        cp, localite = rng.choice(POSTAL_CODES)
        physique = rng.random() < 0.82  # 82% individuals
        sex = rng.choice(['M', 'F', '']) if physique else ''
        # Birth year: uniform 1930-2005 for individuals; None for companies (or 2% missing)
        if physique and rng.random() > 0.02:
            birth = date(rng.randint(1930, 2005), rng.randint(1, 12), rng.randint(1, 28))
        else:
            birth = None
        clients.append({
            'dossier': dossier,
            'sous_dossier': sous_dossier,
            'dossier_key': dossier_key,
            'classement': '',
            'titre': rng.choice(['M.', 'Mme', '']) if physique else '',
            'nom': f'{rng.choice(FIRST_NAMES)} {rng.choice(SURNAMES)}' if physique else f'{rng.choice(SURNAMES)} SA',
            'nom_conjoint': f'{rng.choice(FIRST_NAMES)} {rng.choice(SURNAMES)}' if physique and rng.random() < 0.4 else '',
            'rue': f'Rue du Test {rng.randint(1, 200)}',
            'pays': 'Belgique',
            'code_postal': cp,
            'localite': localite,
            'langue': rng.choice(['FR', 'NL']),
            'date_naissance': iso(birth),
            'telephone': f'+32{rng.randint(100000000, 999999999)}' if rng.random() > 0.1 else '',
            'description_telephone': '',
            'fax': '',
            'email': f'client{i}@example.invalid' if rng.random() > 0.15 else '',
            'profession': rng.choice(PROFESSIONS) if physique and rng.random() > 0.3 else '',
            'physique_morale': 'P' if physique else 'M',
            'etat_civil': rng.choice(CIVIL_STATUSES) if physique and rng.random() > 0.2 else '',
            'sexe': sex,
            'forme_juridique': '' if physique else rng.choice(['SA', 'SPRL', 'ASBL']),
            'statut_social': rng.choice(SOCIAL_STATUSES) if physique and rng.random() > 0.25 else '',
        })
    return clients


def gen_polices(rng, clients, branches):
    polices = []
    branch_codes = sorted(branches.keys())
    police_num = 100000
    for c in clients:
        if rng.random() < SANS_POLICE_RATE:
            continue
        n_pol = 1 if rng.random() < MONO_POLICY_RATE else rng.randint(2, 6)
        for _ in range(n_pol):
            code = rng.choice(branch_codes)
            type_options = branches[code]
            type_police = rng.choice(type_options) if type_options else 'Assurances Animaux'
            domaine = 'Vie et placements' if code in ('VIE', 'PLA') else ('Crédit' if code == 'CRED' else 'IARD')
            effet = date(rng.randint(1990, 2025), rng.randint(1, 12), rng.randint(1, 28))
            police_num += 1
            polices.append({
                'dossier': c['dossier'],
                'sous_dossier': c['sous_dossier'],
                'dossier_key': c['dossier_key'],
                'email': c['email'],
                'police': str(police_num),
                'date_effet': iso(effet),
                'domaine': domaine,
                'type_police': type_police,
                'compagnie': rng.choice(COMPANIES),
            })
    return polices


def gen_compagnies(rng, polices):
    comps = []
    for p in polices:
        # Not all polices have a compagnie row; ~90% do
        if rng.random() > 0.9:
            continue
        prime = round(rng.uniform(150, 3500), 2)
        comps.append({
            'nom': p['compagnie'],
            'numero_fsma': f'{rng.randint(1000, 9999)}',
            'domaine': p['domaine'],
            'dossier': p['dossier'],
            'sous_dossier': p['sous_dossier'],
            'dossier_key': p['dossier_key'],
            'police': p['police'],
            'prime_totale_annuelle': prime,
            'commission_annuelle': round(prime * rng.uniform(0.08, 0.18), 2),
            'periodicite': rng.choice(['Annuelle', 'Semestrielle', 'Trimestrielle', 'Mensuelle']),
        })
    return comps


def gen_sinistres(rng, clients, polices):
    sin = []
    # ~15% of active clients have had a claim
    polices_by_dk = {}
    for p in polices:
        polices_by_dk.setdefault(p['dossier_key'], []).append(p)
    for c in clients:
        if c['dossier_key'] not in polices_by_dk:
            continue
        if rng.random() > 0.15:
            continue
        n = rng.randint(1, 3)
        for _ in range(n):
            p = rng.choice(polices_by_dk[c['dossier_key']])
            evt = date(rng.randint(2015, 2025), rng.randint(1, 12), rng.randint(1, 28))
            sin.append({
                'dossier': c['dossier'],
                'sous_dossier': c['sous_dossier'],
                'dossier_key': c['dossier_key'],
                'classement': '',
                'nom': c['nom'],
                'police': p['police'],
                'description': rng.choice(['Dégât des eaux', 'Vol', 'Accident', 'Incendie', 'Bris de glace']),
                'date_evenement': iso(evt),
                'etat_dossier': rng.choice(['Clôturé', 'En cours', 'En attente']),
                'date_etat': iso(evt + timedelta(days=rng.randint(1, 365))),
                'domaine': p['domaine'],
                'type_police': p['type_police'],
            })
    return sin


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = random.Random(SEED)
    branches = load_branches()

    clients = gen_clients(rng, branches)
    polices = gen_polices(rng, clients, branches)
    compagnies = gen_compagnies(rng, polices)
    sinistres = gen_sinistres(rng, clients, polices)

    for name, data in [
        ('clients', clients),
        ('polices', polices),
        ('compagnies', compagnies),
        ('sinistres', sinistres),
    ]:
        path = os.path.join(OUT, f'{name}.json')
        with open(path, 'w') as f:
            json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)
        print(f'{name}: {len(data)} rows → {path}')


if __name__ == '__main__':
    main()
