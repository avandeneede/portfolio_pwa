from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime

db = SQLAlchemy()


class User(UserMixin, db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    role = db.Column(db.String(10), nullable=False, default='user')
    language = db.Column(db.String(5), nullable=False, default='fr')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    snapshots = db.relationship('Snapshot', backref='user', lazy=True, cascade='all, delete-orphan')

    @property
    def is_admin(self):
        return self.role == 'admin'


class Snapshot(db.Model):
    __tablename__ = 'snapshots'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    snapshot_date = db.Column(db.Date, nullable=False)
    label = db.Column(db.String(100))
    stats_json = db.Column(db.Text)
    client_total_json = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    clients = db.relationship('Client', backref='snapshot', lazy='dynamic', cascade='all, delete-orphan')
    polices = db.relationship('Police', backref='snapshot', lazy='dynamic', cascade='all, delete-orphan')
    compagnie_polices = db.relationship('CompagniePolice', backref='snapshot', lazy='dynamic', cascade='all, delete-orphan')
    sinistres = db.relationship('Sinistre', backref='snapshot', lazy='dynamic', cascade='all, delete-orphan')

    @property
    def client_count(self):
        return self.clients.count()

    @property
    def police_count(self):
        return self.polices.count()


class Client(db.Model):
    __tablename__ = 'clients'
    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.Integer, db.ForeignKey('snapshots.id', ondelete='CASCADE'), nullable=False)
    dossier = db.Column(db.String(20))
    sous_dossier = db.Column(db.String(20))
    dossier_key = db.Column(db.String(50), index=True)
    classement = db.Column(db.String(50))
    titre = db.Column(db.String(50))
    nom = db.Column(db.String(200))
    nom_conjoint = db.Column(db.String(200))
    rue = db.Column(db.String(300))
    pays = db.Column(db.String(50))
    code_postal = db.Column(db.String(20))
    localite = db.Column(db.String(100))
    langue = db.Column(db.String(10))
    date_naissance = db.Column(db.Date)
    telephone = db.Column(db.String(50))
    description_telephone = db.Column(db.String(100))
    fax = db.Column(db.String(50))
    email = db.Column(db.String(200))
    profession = db.Column(db.String(200))
    physique_morale = db.Column(db.String(20))
    etat_civil = db.Column(db.String(50))
    sexe = db.Column(db.String(20))
    forme_juridique = db.Column(db.String(100))
    statut_social = db.Column(db.String(100))

    __table_args__ = (
        db.Index('idx_clients_snapshot_dossier', 'snapshot_id', 'dossier_key'),
    )


class Police(db.Model):
    __tablename__ = 'polices'
    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.Integer, db.ForeignKey('snapshots.id', ondelete='CASCADE'), nullable=False)
    dossier = db.Column(db.String(20))
    sous_dossier = db.Column(db.String(20))
    dossier_key = db.Column(db.String(50), index=True)
    email = db.Column(db.String(200))
    police = db.Column(db.String(50))
    date_effet = db.Column(db.Date)
    domaine = db.Column(db.String(50))
    type_police = db.Column(db.String(100))
    compagnie = db.Column(db.String(200))

    __table_args__ = (
        db.Index('idx_polices_snapshot_dossier', 'snapshot_id', 'dossier_key'),
        db.Index('idx_polices_type_police', 'snapshot_id', 'type_police'),
    )


class CompagniePolice(db.Model):
    __tablename__ = 'compagnie_polices'
    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.Integer, db.ForeignKey('snapshots.id', ondelete='CASCADE'), nullable=False)
    nom = db.Column(db.String(200))
    numero_fsma = db.Column(db.String(50))
    domaine = db.Column(db.String(50))
    dossier = db.Column(db.String(20))
    sous_dossier = db.Column(db.String(20))
    dossier_key = db.Column(db.String(50), index=True)
    police = db.Column(db.String(50))
    prime_totale_annuelle = db.Column(db.Float)
    commission_annuelle = db.Column(db.Float)
    periodicite = db.Column(db.String(50))

    __table_args__ = (
        db.Index('idx_compagnie_polices_snapshot', 'snapshot_id', 'dossier_key'),
    )


class Sinistre(db.Model):
    __tablename__ = 'sinistres'
    id = db.Column(db.Integer, primary_key=True)
    snapshot_id = db.Column(db.Integer, db.ForeignKey('snapshots.id', ondelete='CASCADE'), nullable=False)
    dossier = db.Column(db.String(20))
    sous_dossier = db.Column(db.String(20))
    dossier_key = db.Column(db.String(50), index=True)
    classement = db.Column(db.String(50))
    nom = db.Column(db.String(200))
    police = db.Column(db.String(50))
    description = db.Column(db.String(500))
    date_evenement = db.Column(db.Date)
    etat_dossier = db.Column(db.String(50))
    date_etat = db.Column(db.Date)
    domaine = db.Column(db.String(50))
    type_police = db.Column(db.String(100))

    __table_args__ = (
        db.Index('idx_sinistres_snapshot_dossier', 'snapshot_id', 'dossier_key'),
    )


class AuditLog(db.Model):
    __tablename__ = 'audit_log'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    action = db.Column(db.String(50), nullable=False)
    target = db.Column(db.String(200))
    ip_address = db.Column(db.String(50))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (
        db.Index('idx_audit_log_user', 'user_id', 'timestamp'),
    )


def log_audit(user_id, action, target=None, ip_address=None):
    entry = AuditLog(user_id=user_id, action=action, target=target, ip_address=ip_address)
    db.session.add(entry)
    db.session.commit()
