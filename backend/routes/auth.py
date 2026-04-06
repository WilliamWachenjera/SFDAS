from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token

auth_bp = Blueprint("auth", __name__)

@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json()
    # Simple demo login
    if data.get("email") and data.get("password"):
        token = create_access_token(identity=data["email"])
        return jsonify({"token": token, "user": {"name": "Student", "role": "Admin"}}), 200
    return jsonify({"error": "Invalid credentials"}), 401