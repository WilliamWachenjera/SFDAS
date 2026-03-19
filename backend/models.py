from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Device(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    name = db.Column(db.String(100))
    location = db.Column(db.String(200))
    gps = db.Column(db.String(100))
    status = db.Column(db.String(20), default="online")
    temperature = db.Column(db.Float, default=24.0)
    smoke_level = db.Column(db.Float, default=15.0)
    last_seen = db.Column(db.DateTime, default=datetime.utcnow)

class Alert(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200))
    location = db.Column(db.String(200))
    gps = db.Column(db.String(100))
    severity = db.Column(db.String(20))
    temperature = db.Column(db.Float)
    smoke_level = db.Column(db.Float)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default="active")

class Geofence(db.Model):
    id = db.Column(db.String(50), primary_key=True)
    name = db.Column(db.String(100))
    type = db.Column(db.String(20))  # polygon or radius
    area = db.Column(db.String(100))
    devices_count = db.Column(db.Integer)
    status = db.Column(db.String(20), default="active")