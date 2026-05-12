/*
 * SFDAASS — ESP32 Firmware
 * Smart Fire Detection and Alerting with Automated Suppression System
 *
 * Sensors:  MQ-2 (smoke/gas), Flame sensor, DHT11 (temp/humidity)
 * Comms:    MQTT over Wi-Fi (primary), HTTP fallback
 * GPS:      NEO-6M via Serial2
 * Actuator: Relay → Water pump (sprinkler)
 *
 * MQTT Topics published:
 *   sfdaass/sensors/{DEVICE_CODE}   → sensor readings JSON
 *   sfdaass/status/{DEVICE_CODE}    → heartbeat
 *   sfdaass/gps/{DEVICE_CODE}       → GPS coordinates
 *
 * MQTT Topics subscribed:
 *   sfdaass/sprinkler/{DEVICE_CODE} → {"activate": true/false}
 *   sfdaass/config/{DEVICE_CODE}    → threshold updates
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>

// ─────────────────────────────────────────────────────
// !! CHANGE THESE TO MATCH YOUR SETUP !!
// ─────────────────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* MQTT_HOST     = "069d5c04bf7347f8b2239ffe32a64225.s1.eu.hivemq.cloud"; 
const int   MQTT_PORT     = 8883; // Standard for TLS
const char* DEVICE_CODE   = "ESP32-001";
const char* MQTT_USER     = "sfdaass_device";
const char* MQTT_PASS     = "sfdaass@2026";

// ─────────────────────────────────────────────────────
// PIN DEFINITIONS
// ─────────────────────────────────────────────────────
#define MQ2_PIN          34    // Analog — smoke/gas (ADC1)
#define FLAME_PIN        35    // Digital — flame sensor (LOW = flame)
#define DHT_PIN          4     // DHT11 data pin
#define DHT_TYPE         DHT11
#define RELAY_PIN        26    // Relay IN (HIGH = activate pump)
#define BUZZER_PIN       27    // Active buzzer
#define LED_FIRE_PIN     2     // Built-in LED / fire LED
#define GPS_RX_PIN       16    // GPS TX → ESP32 RX2
#define GPS_TX_PIN       17    // GPS RX → ESP32 TX2 (optional)

// ─────────────────────────────────────────────────────
// THRESHOLDS (overridden by MQTT config topic)
// ─────────────────────────────────────────────────────
float SMOKE_WARNING  = 250.0;
float SMOKE_CRITICAL = 500.0;
float TEMP_WARNING   = 50.0;
float TEMP_CRITICAL  = 100.0;
float GAS_WARNING    = 150.0;
float GAS_CRITICAL   = 300.0;
int   CONFIRM_MS     = 5000;   // Must exceed threshold for this long

// ─────────────────────────────────────────────────────
// OBJECTS
// ─────────────────────────────────────────────────────
WiFiClientSecure wifiClient;
PubSubClient    mqttClient(wifiClient);
DHT             dht(DHT_PIN, DHT_TYPE);
TinyGPSPlus     gps;
HardwareSerial  gpsSerial(2);

// ─────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────
unsigned long lastPublish     = 0;
unsigned long lastHeartbeat   = 0;
unsigned long lastGPS         = 0;
unsigned long fireDetectedAt  = 0;
bool          fireConfirmed   = false;
bool          sprinklerOn     = false;
bool          mqttConnected   = false;

const unsigned long PUBLISH_INTERVAL   = 5000;   // Send sensors every 5s
const unsigned long HEARTBEAT_INTERVAL = 30000;  // Heartbeat every 30s
const unsigned long GPS_INTERVAL       = 10000;  // GPS update every 10s

double gpsLat = 0.0, gpsLng = 0.0;
bool   gpsValid = false;

// ─────────────────────────────────────────────────────
// MQTT CALLBACK — receives commands from backend
// ─────────────────────────────────────────────────────
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  Serial.print("MQTT RX ["); Serial.print(topic); Serial.print("]: ");
  Serial.println(msg);

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, msg)) return;

  String topicStr = String(topic);

  // Sprinkler command: sfdaass/sprinkler/ESP32-001
  if (topicStr.indexOf("/sprinkler/") >= 0) {
    bool activate = doc["activate"] | false;
    setSprinkler(activate);
  }

  // Config update: sfdaass/config/ESP32-001
  if (topicStr.indexOf("/config/") >= 0) {
    if (doc.containsKey("smoke_warning"))  SMOKE_WARNING  = doc["smoke_warning"].as<float>();
    if (doc.containsKey("smoke_critical")) SMOKE_CRITICAL = doc["smoke_critical"].as<float>();
    if (doc.containsKey("temp_warning"))   TEMP_WARNING   = doc["temp_warning"].as<float>();
    if (doc.containsKey("temp_critical"))  TEMP_CRITICAL  = doc["temp_critical"].as<float>();
    if (doc.containsKey("gas_warning"))    GAS_WARNING    = doc["gas_warning"].as<float>();
    if (doc.containsKey("gas_critical"))   GAS_CRITICAL   = doc["gas_critical"].as<float>();
    if (doc.containsKey("confirm_ms"))     CONFIRM_MS     = doc["confirm_ms"].as<int>();
    Serial.println("Config updated.");
  }
}

// ─────────────────────────────────────────────────────
// SPRINKLER CONTROL
// ─────────────────────────────────────────────────────
void setSprinkler(bool on) {
  sprinklerOn = on;
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  Serial.print("Sprinkler: "); Serial.println(on ? "ON" : "OFF");
}

// ─────────────────────────────────────────────────────
// WIFI CONNECT
// ─────────────────────────────────────────────────────
void connectWiFi() {
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500); Serial.print("."); attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\nWi-Fi connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWi-Fi failed. Will retry.");
  }
}

// ─────────────────────────────────────────────────────
// MQTT CONNECT
// ─────────────────────────────────────────────────────
void connectMQTT() {
  wifiClient.setInsecure(); // Skip certificate validation for convenience
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setKeepAlive(60);

  String clientId = String("esp32-") + DEVICE_CODE;

  if (mqttClient.connect(clientId.c_str(),
      strlen(MQTT_USER) ? MQTT_USER : nullptr,
      strlen(MQTT_PASS) ? MQTT_PASS : nullptr)) {
    Serial.println("MQTT connected.");
    mqttConnected = true;

    // Subscribe to command topics
    String sprinklerTopic = String("sfdaass/sprinkler/") + DEVICE_CODE;
    String configTopic    = String("sfdaass/config/") + DEVICE_CODE;
    mqttClient.subscribe(sprinklerTopic.c_str());
    mqttClient.subscribe(configTopic.c_str());
  } else {
    mqttConnected = false;
    Serial.print("MQTT failed, rc="); Serial.println(mqttClient.state());
  }
}

// ─────────────────────────────────────────────────────
// READ SENSORS
// ─────────────────────────────────────────────────────
float readSmokePPM() {
  int raw = analogRead(MQ2_PIN);          // 0–4095 on ESP32
  return raw * (1000.0 / 4095.0);        // Rough calibration to ppm
}

float readGasPPM() {
  int raw = analogRead(MQ2_PIN);
  return raw * (500.0 / 4095.0);         // CO/LPG estimate
}

bool readFlame() {
  return digitalRead(FLAME_PIN) == LOW;  // LOW = flame detected
}

// ─────────────────────────────────────────────────────
// PUBLISH SENSOR DATA
// ─────────────────────────────────────────────────────
void publishSensors() {
  float smoke = readSmokePPM();
  float temp  = dht.readTemperature();
  float hum   = dht.readHumidity();
  float gas   = readGasPPM();
  bool  flame = readFlame();

  if (isnan(temp)) temp = 0;
  if (isnan(hum))  hum  = 0;

  StaticJsonDocument<256> doc;
  doc["smoke_ppm"]      = round(smoke * 10) / 10.0;
  doc["temperature_c"]  = round(temp * 10)  / 10.0;
  doc["humidity_pct"]   = round(hum * 10)   / 10.0;
  doc["gas_ppm"]        = round(gas * 10)   / 10.0;
  doc["flame_detected"] = flame;
  doc["battery_pct"]    = getBatteryPercent();
  if (gpsValid) {
    doc["lat"] = gpsLat;
    doc["lng"] = gpsLng;
  }

  char buf[256];
  serializeJson(doc, buf);

  String topic = String("sfdaass/sensors/") + DEVICE_CODE;
  bool ok = mqttClient.publish(topic.c_str(), buf, true);

  Serial.printf("Sensors → Smoke:%.0f Temp:%.1f Hum:%.1f Gas:%.0f Flame:%d [%s]\n",
    smoke, temp, hum, gas, flame, ok ? "OK" : "FAIL");

  // ── Local fire detection ──────────────────────────
  bool alert = flame || smoke >= SMOKE_WARNING || temp >= TEMP_WARNING || gas >= GAS_WARNING;

  if (alert && fireDetectedAt == 0) {
    fireDetectedAt = millis();
    Serial.println("⚠ Fire condition detected — confirming...");
  } else if (!alert) {
    fireDetectedAt = 0;
    fireConfirmed  = false;
    digitalWrite(LED_FIRE_PIN, LOW);
    noTone(BUZZER_PIN);
  }

  // Confirm after CONFIRM_MS milliseconds of sustained reading
  if (fireDetectedAt > 0 && !fireConfirmed && (millis() - fireDetectedAt >= (unsigned long)CONFIRM_MS)) {
    fireConfirmed = true;
    onFireConfirmed(smoke, temp, gas, flame, hum);
  }
}

// ─────────────────────────────────────────────────────
// FIRE CONFIRMED
// ─────────────────────────────────────────────────────
void onFireConfirmed(float smoke, float temp, float gas, bool flame, float hum) {
  Serial.println("🔥 FIRE CONFIRMED — activating response!");

  // Visual + audio alert
  digitalWrite(LED_FIRE_PIN, HIGH);
  tone(BUZZER_PIN, 1000);

  // Activate sprinkler if critical
  if (flame || smoke >= SMOKE_CRITICAL || temp >= TEMP_CRITICAL) {
    setSprinkler(true);
  }

  // Publish explicit alert to backend
  StaticJsonDocument<256> doc;
  doc["smoke_ppm"]      = smoke;
  doc["temperature_c"]  = temp;
  doc["humidity_pct"]   = hum;
  doc["gas_ppm"]        = gas;
  doc["flame_detected"] = flame;
  if (gpsValid) { doc["lat"] = gpsLat; doc["lng"] = gpsLng; }

  char buf[256];
  serializeJson(doc, buf);

  String alertTopic = String("sfdaass/alert/") + DEVICE_CODE;
  mqttClient.publish(alertTopic.c_str(), buf, true);
}

// ─────────────────────────────────────────────────────
// GPS READ
// ─────────────────────────────────────────────────────
void updateGPS() {
  while (gpsSerial.available() > 0) {
    char c = gpsSerial.read();
    gps.encode(c);
  }
  if (gps.location.isValid() && gps.location.isUpdated()) {
    gpsLat   = gps.location.lat();
    gpsLng   = gps.location.lng();
    gpsValid = true;

    StaticJsonDocument<64> doc;
    doc["lat"] = gpsLat;
    doc["lng"] = gpsLng;
    doc["accuracy"] = gps.hdop.value() / 100.0;

    char buf[64];
    serializeJson(doc, buf);
    String gpsTopic = String("sfdaass/gps/") + DEVICE_CODE;
    mqttClient.publish(gpsTopic.c_str(), buf);
  }
}

// ─────────────────────────────────────────────────────
// BATTERY (voltage divider on ADC)
// Replace with actual measurement for your circuit
// ─────────────────────────────────────────────────────
float getBatteryPercent() {
  // Example: 100K + 100K voltage divider on GPIO 33
  // int raw = analogRead(33);
  // float voltage = raw * (3.3 / 4095.0) * 2;
  // return constrain((voltage - 3.0) / (4.2 - 3.0) * 100.0, 0, 100);
  return 85.0; // Placeholder — replace with real measurement
}

// ─────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  pinMode(FLAME_PIN, INPUT);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_FIRE_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  dht.begin();
  delay(500);

  connectWiFi();
  connectMQTT();

  // Startup heartbeat
  publishHeartbeat("online");
  Serial.println("✅ SFDAASS firmware ready.");
}

// ─────────────────────────────────────────────────────
// PUBLISH HEARTBEAT
// ─────────────────────────────────────────────────────
void publishHeartbeat(const char* status) {
  StaticJsonDocument<128> doc;
  doc["status"]  = status;
  doc["uptime"]  = millis() / 1000;
  doc["fw"]      = "1.0.0";
  doc["ip"]      = WiFi.localIP().toString();

  char buf[128];
  serializeJson(doc, buf);
  String topic = String("sfdaass/status/") + DEVICE_CODE;
  mqttClient.publish(topic.c_str(), buf);
}

// ─────────────────────────────────────────────────────
// LOOP
// ─────────────────────────────────────────────────────
void loop() {
  // Reconnect Wi-Fi if dropped
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    return;
  }

  // Reconnect MQTT if dropped
  if (!mqttClient.connected()) {
    connectMQTT();
    delay(1000);
    return;
  }

  mqttClient.loop();

  unsigned long now = millis();

  if (now - lastPublish >= PUBLISH_INTERVAL) {
    lastPublish = now;
    publishSensors();
  }

  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    publishHeartbeat("online");
  }

  if (now - lastGPS >= GPS_INTERVAL) {
    lastGPS = now;
    updateGPS();
  }
}
