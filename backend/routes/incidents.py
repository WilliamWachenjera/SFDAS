from flask import Blueprint, jsonify
from models import Alert

incidents_bp = Blueprint("incidents", __name__)

@incidents_bp.route("/incidents", methods=["GET"])
def get_incidents():
    # Reuse Alert model for simplicity
    incidents = Alert.query.order_by(Alert.timestamp.desc()).all()
    return jsonify([{
        "id": f"INC-{a.id}",
        "title": a.title,
        "location": a.location,
        "gps": a.gps or "40.7128° N, 74.0060° W",
        "severity": a.severity,
        "date": a.timestamp.strftime("%Y-%m-%d"),
        "time": a.timestamp.strftime("%H:%M"),
        "temperature": a.temperature,
        "smoke": a.smoke_level,
        "sprinklerActivated": True,
        "responseTime": "2m 15s",
        "status": a.status
    } for a in incidents])