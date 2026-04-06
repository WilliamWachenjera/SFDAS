from flask import Blueprint, jsonify
from models import Geofence

geofence_bp = Blueprint("geofence", __name__)

@geofence_bp.route("/geofence", methods=["GET"])
def get_geofences():
    geofences = Geofence.query.all()
    return jsonify([{
        "id": g.id,
        "name": g.name,
        "type": g.type,
        "area": g.area,
        "devices": g.devices_count,
        "status": g.status
    } for g in geofences])