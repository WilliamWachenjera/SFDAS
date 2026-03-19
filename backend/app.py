from flask import Flask
from flask_cors import CORS
from config import Config
from models import db
from routes.devices import devices_bp
from routes.alerts import alerts_bp
from routes.incidents import incidents_bp
from routes.geofence import geofence_bp
from routes.auth import auth_bp

app = Flask(__name__)
app.config.from_object(Config)

CORS(app)  # Allow React frontend to connect

db.init_app(app)

# Register routes
app.register_blueprint(auth_bp, url_prefix="/api/auth")
app.register_blueprint(devices_bp, url_prefix="/api")
app.register_blueprint(alerts_bp, url_prefix="/api")
app.register_blueprint(incidents_bp, url_prefix="/api")
app.register_blueprint(geofence_bp, url_prefix="/api")

# Create tables
with app.app_context():
    db.create_all()

if __name__ == "__main__":
    app.run(debug=True, port=5000)