from flask import Blueprint, jsonify
from models import Device

devices_bp = Blueprint("devices", __name__)

@devices_bp.route("/devices", methods=["GET"])
def get_devices():
    devices = Device.query.all()
    return jsonify([{
        "id": d.id,
        "name": d.name,
        "location": d.location,
        "gps": d.gps,
        "status": d.status,
        "temperature": d.temperature,
        "smoke": d.smoke_level,
        "lastSeen": d.last_seen.strftime("%H:%M")
    } for d in devices])