from flask import Blueprint, jsonify
from models import Alert

alerts_bp = Blueprint("alerts", __name__)

@alerts_bp.route("/alerts", methods=["GET"])
def get_alerts():
    alerts = Alert.query.order_by(Alert.timestamp.desc()).limit(10).all()
    return jsonify([{
        "id": a.id,
        "title": a.title,
        "location": a.location,
        "severity": a.severity,
        "temperature": a.temperature,
        "smoke": a.smoke_level,
        "time": a.timestamp.strftime("%H:%M")
    } for a in alerts])