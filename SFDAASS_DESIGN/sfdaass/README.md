# 🔥 SFDAASS — Smart Fire Detection, Alerting & Automated Suppression System

> **Version:** 1.0.0 | **Platform:** Node.js + PostgreSQL + Socket.IO + MQTT | **Language:** English

---

## 📋 Table of Contents

1. [Project Overview](#-project-overview)
2. [System Architecture](#-system-architecture)
3. [Project Structure](#-project-structure)
4. [Prerequisites](#-prerequisites)
5. [Quick Start (Demo Mode)](#-quick-start-demo-mode)
6. [Full Production Setup](#-full-production-setup)
   - [PostgreSQL Setup](#1-postgresql-setup)
   - [Environment Configuration](#2-environment-configuration)
   - [Backend Installation & Run](#3-backend-installation--run)
   - [Frontend Setup](#4-frontend-setup)
   - [MQTT Broker Setup (Optional)](#5-mqtt-broker-setup-optional)
7. [IoT Device Setup (ESP32 Firmware)](#-iot-device-setup-esp32-firmware)
8. [API Reference](#-api-reference)
9. [Default Credentials](#-default-credentials)
10. [Sensor Thresholds & Fire Logic](#-sensor-thresholds--fire-logic)
11. [Troubleshooting](#-troubleshooting)
12. [Tech Stack Summary](#-tech-stack-summary)

---

## 📖 Project Overview

SFDAASS is a complete IoT-based fire safety platform that:

- **Detects** fire using multi-sensor fusion (smoke, temperature, gas, flame)
- **Confirms** events using a 5-second threshold window to prevent false alarms
- **Classifies** severity as Low / Warning / Critical
- **Alerts** via SMS (Twilio), Email (SMTP), and real-time dashboard push
- **Suppresses** fires automatically via water sprinkler relay control
- **Geofences** the protected area (circle or polygon) using GPS coordinates
- **Reports** all incidents automatically as CSV (PDF via extension)
- **Monitors** all connected IoT devices in real time via Socket.IO + MQTT
- **Authenticates** users with JWT access tokens + refresh token rotation

---

## 🏗 System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  FIELD / HARDWARE LAYER                  │
│  ESP32 + MQ-2 + DHT11 + Flame + Gas + NEO-6M GPS        │
│  Relay → Water Pump / Solenoid | Buzzer | LED            │
└──────────┬──────────────────────────────────┬────────────┘
           │ HTTPS POST /api/sensor/reading    │ MQTT publish
           │ X-Device-Key header               │ sfdaass/devices/{id}/telemetry
           ▼                                   ▼
┌──────────────────────────────────────────────────────────┐
│                    BACKEND SERVER                        │
│  Node.js + Express  (server.js)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Auth API │ │Sensor API│ │Incidents │ │Geofence   │  │
│  │ JWT/BCrypt│ │Fire Engine│ │CRUD+CSV │ │Management │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │Socket.IO │ │MQTT Bridge│ │Notif.Svc │                 │
│  │Real-time │ │   Bridge  │ │SMS+Email │                 │
│  └──────────┘ └──────────┘ └──────────┘                 │
└────────────────────┬─────────────────────────────────────┘
                     │
           ┌─────────┴─────────┐
           ▼                   ▼
┌──────────────────┐  ┌────────────────────────────────────┐
│   PostgreSQL DB  │  │         FRONTEND DASHBOARD         │
│  schema.sql      │  │  SFDAASS_App.html                  │
│  All tables,     │  │  ├─ Login + JWT auth               │
│  views, triggers │  │  ├─ Real-time Socket.IO client     │
└──────────────────┘  │  ├─ Dashboard + Live Charts        │
                       │  ├─ Device Monitoring + Map        │
                       │  ├─ Incident History + Export      │
                       │  ├─ Geofence Management            │
                       │  ├─ Sprinkler Zone Control         │
                       │  ├─ User Management (Admin)        │
                       │  ├─ About / Developers / Contact   │
                       │  └─ Demo Mode (offline fallback)   │
                       └────────────────────────────────────┘
```

---

## 📁 Project Structure

```
sfdaass/
├── backend/
│   ├── server.js                  # Main entry point (Express + Socket.IO + MQTT)
│   ├── package.json               # Node.js dependencies
│   ├── .env.example               # Environment variable template
│   │
│   ├── database/
│   │   ├── schema.sql             # Complete PostgreSQL schema (tables, views, triggers)
│   │   └── db.js                  # PostgreSQL connection pool + query helpers
│   │
│   ├── middleware/
│   │   └── auth.js                # JWT auth middleware + device API key middleware
│   │
│   ├── routes/
│   │   ├── auth.js                # Login, register, refresh, logout, change-password
│   │   ├── sensor.js              # IoT data ingestion + fire pipeline (HTTP)
│   │   ├── devices.js             # Device CRUD + API key management
│   │   ├── incidents.js           # Incident CRUD, resolve, CSV export
│   │   └── other.js               # Sprinklers, Geofence, Users, Contact, Dashboard
│   │
│   ├── mqtt/
│   │   └── bridge.js              # MQTT broker connection + message processing
│   │
│   ├── socket/
│   │   └── manager.js             # Socket.IO event manager + auth middleware
│   │
│   └── utils/
│       ├── fireEngine.js          # Fire detection logic, thresholds, confirmation
│       ├── geofence.js            # Haversine distance + point-in-polygon
│       ├── notifications.js       # Email (Nodemailer) + SMS (Twilio) service
│       └── logger.js              # Winston structured logging
│
├── frontend/
│   └── SFDAASS_App.html           # Complete single-file frontend dashboard
│
├── firmware/
│   └── sfdaass_device.ino         # ESP32 Arduino firmware (sensors + MQTT + HTTP)
│
└── README.md                      # This file
```

---

## ✅ Prerequisites

### For Demo Mode (No backend needed)
- Any modern web browser (Chrome, Firefox, Edge)
- Open `frontend/SFDAASS_App.html` directly — that's it

### For Full Production
| Component | Version | Notes |
|-----------|---------|-------|
| Node.js   | ≥ 18.0  | [nodejs.org](https://nodejs.org) |
| npm       | ≥ 9.0   | Comes with Node.js |
| PostgreSQL | ≥ 14   | [postgresql.org](https://postgresql.org) |
| Mosquitto MQTT | Any | Optional — for IoT device communication |

### Optional (for full features)
| Feature | Service | Notes |
|---------|---------|-------|
| SMS Alerts | Twilio | Free trial available at twilio.com |
| Email Alerts | Gmail SMTP | Use App Password, not main password |
| IoT Devices | ESP32 | Arduino IDE with libraries listed in firmware |

---

## ⚡ Quick Start (Demo Mode)

**No installation needed. Runs entirely in the browser.**

```bash
# 1. Open the frontend file in your browser
open frontend/SFDAASS_App.html
# Or double-click the file in your file manager

# 2. Login with demo credentials:
#    Email:    admin@sfdaass.io
#    Password: Admin@1234
```

**Demo mode features:**
- ✅ All 8 pages fully functional
- ✅ Live sensor simulation (auto-updating every 3 seconds)
- ✅ Interactive Leaflet maps with device markers
- ✅ Real fire simulation (click "Simulate Fire" on dashboard)
- ✅ Sprinkler zone toggle controls
- ✅ Incident modal with timeline
- ✅ CSV export (downloads locally)
- ⚠️ No real database (data is in-memory)
- ⚠️ No real SMS/email alerts

---

## 🚀 Full Production Setup

### 1. PostgreSQL Setup

```bash
# Install PostgreSQL (Ubuntu/Debian)
sudo apt update
sudo apt install postgresql postgresql-contrib

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << 'EOF'
CREATE DATABASE sfdaass_db;
CREATE USER sfdaass_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE sfdaass_db TO sfdaass_user;
\c sfdaass_db
GRANT ALL ON SCHEMA public TO sfdaass_user;
EOF

# Run the schema (creates all tables, views, triggers, seed data)
sudo -u postgres psql -d sfdaass_db -f backend/database/schema.sql

# Verify tables were created
sudo -u postgres psql -d sfdaass_db -c "\dt"
```

**Expected tables after setup:**
```
 users               refresh_tokens      geofences
 devices             device_telemetry    sensor_readings
 incidents           incident_events     sprinkler_zones
 sprinkler_activations  alert_notifications  contact_messages
 audit_log           system_config
```

---

### 2. Environment Configuration

```bash
# Copy the example env file
cp backend/.env.example backend/.env

# Edit with your values
nano backend/.env
```

**Minimum required settings:**
```env
# Database (MUST match what you set in step 1)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sfdaass_db
DB_USER=sfdaass_user
DB_PASSWORD=your_secure_password

# JWT (generate strong secrets — minimum 64 characters)
JWT_SECRET=change_this_to_a_very_long_random_string_64_chars_minimum_abc123
JWT_REFRESH_SECRET=another_very_long_random_refresh_secret_64_chars_minimum_xyz789

# CORS (URL of your frontend)
CORS_ORIGIN=http://localhost:3000
# If serving frontend from same server: CORS_ORIGIN=http://your-server-ip:5000
```

**Generate secure JWT secrets:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Optional — Email alerts (Gmail):**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your.email@gmail.com
SMTP_PASS=your_gmail_app_password   # Not your main password!
ADMIN_EMAIL=admin@yourdomain.com
ALERT_EMAIL_FROM=SFDAASS <alerts@yourdomain.com>
```

> **Gmail App Password:** Go to Google Account → Security → 2-Step Verification → App passwords

**Optional — SMS alerts (Twilio):**
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
ALERT_PHONE_NUMBERS=+265999000001,+265999000002
```

---

### 3. Backend Installation & Run

```bash
# Navigate to backend
cd backend

# Install all dependencies
npm install

# Start in development mode (auto-restarts on file change)
npm run dev

# OR start in production mode
npm start
```

**Expected startup output:**
```
2025-07-12 02:14:33 [info] ═══════════════════════════════════════════
2025-07-12 02:14:33 [info]   SFDAASS — Fire Safety Platform v1.0.0
2025-07-12 02:14:33 [info] ═══════════════════════════════════════════
2025-07-12 02:14:33 [info] ✅ PostgreSQL connected: sfdaass_db @ 2025-07-12...
2025-07-12 02:14:33 [info] ✅ HTTP server listening on port 5000
2025-07-12 02:14:33 [info] ✅ Socket.IO ready on port 5000
2025-07-12 02:14:33 [info] 🌐 API base: http://localhost:5000/api
2025-07-12 02:14:33 [info] ❤️  Health: http://localhost:5000/api/health
```

**Verify the server is running:**
```bash
curl http://localhost:5000/api/health
# Expected: {"status":"ok","database":"connected",...}
```

---

### 4. Frontend Setup

The frontend is a **single HTML file** — no build step required.

**Option A — Serve via the backend (recommended):**
```bash
# The backend serves the frontend in production mode automatically
# Just set NODE_ENV=production and put SFDAASS_App.html in backend/public/
mkdir -p backend/public
cp frontend/SFDAASS_App.html backend/public/index.html

# Update frontend to point to the backend
# Edit the API_BASE line in SFDAASS_App.html:
# const API_BASE = '/api';   ← remove localhost reference
```

**Option B — Open directly in browser (development):**
```bash
# Update API_BASE in SFDAASS_App.html to point to your backend:
# const API_BASE = 'http://localhost:5000/api';

open frontend/SFDAASS_App.html
```

**Option C — Serve with any static server:**
```bash
# Using Python
cd frontend && python3 -m http.server 3000

# Using Node.js serve
npx serve frontend -p 3000
```

---

### 5. MQTT Broker Setup (Optional)

Only needed if you're connecting real ESP32 IoT devices via MQTT.

```bash
# Install Mosquitto MQTT broker (Ubuntu)
sudo apt install mosquitto mosquitto-clients

# Configure with authentication
sudo nano /etc/mosquitto/conf.d/sfdaass.conf
```

```conf
# /etc/mosquitto/conf.d/sfdaass.conf
listener 1883
allow_anonymous false
password_file /etc/mosquitto/passwd
```

```bash
# Create MQTT users
sudo mosquitto_passwd -c /etc/mosquitto/passwd sfdaass_server
sudo mosquitto_passwd /etc/mosquitto/passwd sfdaass_devices

# Restart broker
sudo systemctl restart mosquitto
sudo systemctl enable mosquitto

# Test connection
mosquitto_sub -h localhost -u sfdaass_server -P your_password -t "sfdaass/#" -v
```

Update your `.env`:
```env
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=sfdaass_server
MQTT_PASSWORD=your_mqtt_server_password
```

---

## 🔌 IoT Device Setup (ESP32 Firmware)

### Arduino IDE Libraries Required

Install via **Arduino IDE → Sketch → Include Library → Manage Libraries**:

| Library | Install Name |
|---------|-------------|
| DHT Sensor Library | `DHT sensor library` by Adafruit |
| ArduinoJson | `ArduinoJson` by Benoit Blanchon |
| PubSubClient (MQTT) | `PubSubClient` by Nick O'Leary |
| TinyGPS++ | `TinyGPSPlus` by Mikal Hart |

### Board Setup
1. Open Arduino IDE
2. Go to **File → Preferences → Additional Board URLs**
3. Add: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
4. **Tools → Board → Board Manager** → search "esp32" → Install
5. Select **ESP32 Dev Module**

### Configure the Firmware

Open `firmware/sfdaass_device.ino` and edit these lines:

```cpp
const char* WIFI_SSID      = "YOUR_WIFI_SSID";        // Your WiFi network name
const char* WIFI_PASSWORD  = "YOUR_WIFI_PASSWORD";     // Your WiFi password
const char* DEVICE_CODE    = "DEV-001";                // From device registration
const char* DEVICE_API_KEY = "YOUR_API_KEY";           // From registration response
const char* SERVER_URL     = "http://192.168.1.100:5000/api/sensor/reading";
const char* MQTT_BROKER    = "192.168.1.100";          // Your server IP
```

### Register a Device First

Before flashing, register the device via the dashboard or API:

```bash
# Via API (replace with your admin token)
curl -X POST http://localhost:5000/api/devices \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_code": "DEV-001",
    "name": "Zone A Sensor",
    "location_label": "Building 3, Zone A",
    "firmware_version": "1.0.0"
  }'

# The response includes the api_key — copy it into the firmware
```

### Wiring Diagram

```
ESP32 Pin  →  Component
──────────────────────────────────────
GPIO34     →  MQ-2 Smoke Sensor (AO)
GPIO35     →  Gas Sensor (AO)
GPIO26     →  Flame Sensor (DO)
GPIO27     →  DHT11 Data Pin
GPIO25     →  Relay Module (IN) → Water Pump
GPIO14     →  Buzzer (+)
GPIO12     →  Red LED (+) → 220Ω resistor → GND
GPIO13     →  Green LED (+) → 220Ω resistor → GND
GPIO16     →  GPS NEO-6M TX
GPIO17     →  GPS NEO-6M RX
3.3V       →  DHT11 VCC, Flame Sensor VCC
5V         →  MQ-2 VCC, Gas Sensor VCC, GPS VCC, Relay VCC
GND        →  All sensor GNDs
```

### Flash the Device
1. Connect ESP32 via USB
2. Open `firmware/sfdaass_device.ino` in Arduino IDE
3. Select the correct COM port
4. Click **Upload**
5. Open Serial Monitor (115200 baud) to see debug output

---

## 📡 API Reference

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/login` | Login with email + password | None |
| POST | `/api/auth/register` | Register new user | None |
| POST | `/api/auth/refresh` | Refresh access token | None |
| POST | `/api/auth/logout` | Logout + revoke token | Bearer |
| GET | `/api/auth/me` | Get current user info | Bearer |
| PATCH | `/api/auth/change-password` | Change password | Bearer |

**Login request:**
```json
POST /api/auth/login
{ "email": "admin@sfdaass.io", "password": "Admin@1234" }
```
**Response:**
```json
{ "success": true, "accessToken": "eyJ...", "refreshToken": "eyJ...", "user": {...} }
```

### IoT Device Data (Device → Server)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/api/sensor/reading` | Submit sensor reading | X-Device-Key |
| GET | `/api/sensor/latest/:deviceCode` | Get latest reading | Bearer |
| GET | `/api/sensor/history/:deviceCode` | Get historical readings | Bearer |

**Sensor reading payload:**
```json
POST /api/sensor/reading
Headers: X-Device-Key: YOUR_DEVICE_API_KEY

{
  "smoke_ppm": 450.5,
  "temperature_c": 78.2,
  "gas_ppm": 320.0,
  "humidity_pct": 38.5,
  "flame_detected": false,
  "gps_lat": -13.9626,
  "gps_lng": 33.7741,
  "gps_accuracy_m": 4.2,
  "battery_pct": 87,
  "rssi": -62,
  "uptime_seconds": 3600
}
```

### Dashboard

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/dashboard/stats` | All dashboard statistics | Bearer |
| GET | `/api/dashboard/chart-data` | Hourly chart data | Bearer |

### Devices

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/devices` | List all devices | Bearer |
| GET | `/api/devices/:id` | Get device details | Bearer |
| POST | `/api/devices` | Register new device | Admin/Operator |
| PATCH | `/api/devices/:id` | Update device | Admin/Operator |
| DELETE | `/api/devices/:id` | Deactivate device | Admin |
| POST | `/api/devices/:id/regenerate-key` | New API key | Admin |

### Incidents

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/incidents` | List incidents | Bearer |
| GET | `/api/incidents/stats` | Incident statistics | Bearer |
| GET | `/api/incidents/:id` | Get incident + timeline | Bearer |
| PATCH | `/api/incidents/:id/resolve` | Resolve incident | Admin/Operator |
| PATCH | `/api/incidents/:id/false-alarm` | Mark false alarm | Admin/Operator |
| GET | `/api/incidents/:id/export/csv` | Download CSV report | Bearer |
| GET | `/api/incidents/export/all` | Download all incidents CSV | Bearer |

### Sprinklers

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/sprinklers` | List all zones | Bearer |
| POST | `/api/sprinklers/:zoneCode/activate` | Activate zone | Admin/Operator |
| POST | `/api/sprinklers/:zoneCode/deactivate` | Deactivate zone | Admin/Operator |
| GET | `/api/sprinklers/history` | Activation history | Bearer |

### Geofence

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/geofence` | List geofences | Bearer |
| GET | `/api/geofence/active` | Get active geofence | Bearer |
| POST | `/api/geofence` | Create geofence | Admin/Operator |
| PATCH | `/api/geofence/:id` | Update geofence | Admin/Operator |

### Socket.IO Events

**Server → Client:**
```
sensor:reading      — Live sensor data from device
incident:created    — New fire incident confirmed
incident:update     — Incident updated
incident:resolved   — Incident marked resolved
sprinkler:activated — Sprinkler zone turned on
sprinkler:deactivated
device:status       — Device online/offline change
geofence:updated    — Geofence configuration changed
system:heartbeat    — Server alive ping (every 30s)
init:state          — Initial state on connect
```

**Client → Server:**
```
subscribe:device    — Subscribe to specific device updates
sprinkler:control   — Manual sprinkler control { zoneCode, action }
incident:resolve    — Quick resolve { incidentId, notes }
```

---

## 🔑 Default Credentials

> ⚠️ **CHANGE THESE IMMEDIATELY IN PRODUCTION**

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@sfdaass.io | Admin@1234 |
| Operator | operator@sfdaass.io | Admin@1234 |

**Change password via API:**
```bash
curl -X PATCH http://localhost:5000/api/auth/change-password \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Admin@1234","newPassword":"YourNewSecure@Pass99"}'
```

---

## 🔥 Sensor Thresholds & Fire Logic

### Detection Thresholds (configurable via .env)

| Sensor | Warning | Critical |
|--------|---------|----------|
| Smoke (MQ-2) | ≥ 300 ppm | ≥ 500 ppm |
| Temperature | ≥ 60°C | ≥ 100°C |
| Gas (CO/LPG) | ≥ 400 ppm | ≥ 700 ppm |
| Flame sensor | N/A | Triggered |

### Fire Confirmation Logic

```
Score Calculation:
  Smoke ≥ Critical  → +40 pts
  Smoke ≥ Warning   → +20 pts
  Temp  ≥ Critical  → +40 pts
  Temp  ≥ Warning   → +20 pts
  Gas   ≥ Critical  → +30 pts
  Gas   ≥ Warning   → +15 pts
  Flame Detected    → +50 pts

Classification:
  Score ≥ 60 → CRITICAL (auto-suppress)
  Score ≥ 20 → WARNING
  Score  < 20 → NORMAL

False Alarm Prevention:
  Elevated score must PERSIST for 5 seconds
  AND at least 2 consecutive readings must be elevated
  before an incident is created.

Auto-Suppression:
  Activates ONLY when:
  ✓ Severity = CRITICAL
  ✓ Device GPS is INSIDE the geofence
  ✓ SUPPRESSION_AUTO is not disabled in .env
```

Customize thresholds in `.env`:
```env
SMOKE_WARNING_THRESHOLD=300
SMOKE_CRITICAL_THRESHOLD=500
TEMP_WARNING_THRESHOLD=60
TEMP_CRITICAL_THRESHOLD=100
GAS_WARNING_THRESHOLD=400
GAS_CRITICAL_THRESHOLD=700
FIRE_CONFIRM_DURATION_MS=5000
```

---

## 🛠 Troubleshooting

### Backend won't start
```bash
# Check Node version
node --version  # Must be ≥ 18

# Check if port 5000 is in use
lsof -i :5000
kill -9 <PID>

# Check logs
cat backend/logs/error.log
```

### Database connection failed
```bash
# Test PostgreSQL connection
psql -h localhost -U sfdaass_user -d sfdaass_db -c "SELECT NOW();"

# Check PostgreSQL is running
sudo systemctl status postgresql

# Check .env DB credentials match your PostgreSQL setup
```

### Frontend shows "Cannot connect to server"
```bash
# Confirm backend is running
curl http://localhost:5000/api/health

# Check CORS_ORIGIN in .env matches your frontend URL exactly
# e.g. CORS_ORIGIN=http://localhost:3000  (no trailing slash)

# Check browser console for CORS errors
```

### IoT device not sending data
```bash
# Check Serial Monitor in Arduino IDE (115200 baud)
# Look for: [WiFi] Connected or [HTTP] Reading sent OK

# Test HTTP endpoint manually
curl -X POST http://your-server:5000/api/sensor/reading \
  -H "X-Device-Key: YOUR_DEVICE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"smoke_ppm":100,"temperature_c":30,"flame_detected":false}'
```

### MQTT not connecting
```bash
# Check Mosquitto is running
sudo systemctl status mosquitto

# Test MQTT manually
mosquitto_pub -h localhost -u sfdaass_devices -P password \
  -t "sfdaass/devices/DEV-001/telemetry" \
  -m '{"smoke_ppm":150,"temperature_c":35}'

# Check backend MQTT logs
grep MQTT backend/logs/combined.log
```

### SMS alerts not sending
```bash
# Verify Twilio credentials in .env
# Check Twilio account balance (trial accounts limited)
# Check ALERT_PHONE_NUMBERS format: +265999000001,+265999000002
```

---

## 📦 Tech Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **IoT Firmware** | ESP32 + Arduino C++ | Sensor polling, GPS, MQTT/HTTP client |
| **Communication** | MQTT + HTTPS | Device → Server data transmission |
| **Backend** | Node.js + Express | REST API, business logic |
| **Real-time** | Socket.IO | Live dashboard updates |
| **Database** | PostgreSQL | Persistent storage, time-series |
| **Auth** | JWT + Bcrypt | User authentication + device auth |
| **Alerting** | Twilio + Nodemailer | SMS and email notifications |
| **Broker** | Mosquitto MQTT | IoT message routing |
| **Frontend** | Vanilla HTML/CSS/JS | Dashboard (no build step needed) |
| **Maps** | Leaflet.js | Interactive geospatial maps |
| **Charts** | Chart.js | Sensor data visualization |
| **Logging** | Winston | Structured server-side logging |

---

## 📄 License

This project was developed as an academic/research system by the SFDAASS Development Team,
University of Malawi, Zomba Campus.

For questions: support@sfdaass.io | emergency@sfdaass.io

---

*SFDAASS v1.0.0 — Built with ❤️ for fire safety*
