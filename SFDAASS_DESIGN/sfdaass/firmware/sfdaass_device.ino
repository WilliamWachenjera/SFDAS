/**
 * SFDAASS — IoT Device Firmware
 * Smart Fire Detection, Alerting & Automated Suppression System
 *
 * Hardware: ESP32 (Arduino framework)
 * Sensors:  MQ-2 (Smoke), DHT11 (Temp/Humidity), Flame sensor, Gas sensor
 * GPS:      NEO-6M via SoftwareSerial
 * Actuator: Relay → Water Pump/Sprinkler
 *
 * Communicates with backend via:
 *   1. HTTPS POST to /api/sensor/reading
 *   2. MQTT publish to sfdaass/devices/{DEVICE_CODE}/telemetry
 *   3. MQTT subscribe to sfdaass/devices/{DEVICE_CODE}/command
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>

// ── CONFIG (Change these) ────────────────────────────────────────
const char* WIFI_SSID      = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD  = "YOUR_WIFI_PASSWORD";
const char* DEVICE_CODE    = "DEV-001";
const char* DEVICE_API_KEY = "YOUR_DEVICE_API_KEY_FROM_REGISTRATION";
const char* SERVER_URL     = "http://your-server.com/api/sensor/reading";
const char* MQTT_BROKER    = "your-server.com";
const int   MQTT_PORT      = 1883;
const char* MQTT_USER      = "sfdaass_devices";
const char* MQTT_PASS      = "mqtt_device_password";

// ── PIN ASSIGNMENTS ──────────────────────────────────────────────
#define MQ2_PIN         34    // Smoke sensor (analog)
#define GAS_PIN         35    // Gas sensor (analog)
#define FLAME_PIN       26    // Flame sensor (digital)
#define DHT_PIN         27    // DHT11
#define RELAY_PIN       25    // Sprinkler relay (active LOW)
#define BUZZER_PIN      14    // Alarm buzzer
#define LED_RED_PIN     12    // Fire alert LED
#define LED_GREEN_PIN   13    // System OK LED
#define GPS_RX          16    // GPS module RX
#define GPS_TX          17    // GPS module TX

// ── THRESHOLDS ───────────────────────────────────────────────────
#define SMOKE_WARNING   300
#define SMOKE_CRITICAL  500
#define TEMP_WARNING    60
#define TEMP_CRITICAL   100
#define GAS_WARNING     400
#define GAS_CRITICAL    700

// ── TIMING ───────────────────────────────────────────────────────
#define READ_INTERVAL_MS    2000    // Sensor read interval
#define SEND_INTERVAL_MS   10000   // Data upload interval
#define GPS_TIMEOUT_MS      5000   // GPS fix timeout

// ── OBJECTS ──────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT11);
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);  // UART2
WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

// ── MQTT TOPICS ──────────────────────────────────────────────────
String TOPIC_TELEMETRY;
String TOPIC_COMMAND;
String TOPIC_STATUS;

// ── STATE ────────────────────────────────────────────────────────
struct SensorData {
  float smoke_ppm     = 0;
  float temperature_c = 0;
  float gas_ppm       = 0;
  float humidity_pct  = 0;
  bool  flame_detected = false;
  double gps_lat      = 0;
  double gps_lng      = 0;
  float gps_accuracy  = 0;
  bool  gps_valid     = false;
  int   rssi          = 0;
  float battery_pct   = 100;
  unsigned long uptime = 0;
};

SensorData data;
bool sprinklerActive = false;
bool alarmActive     = false;
unsigned long lastReadTime = 0;
unsigned long lastSendTime = 0;
unsigned long bootTime     = millis();

// ── SETUP ────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);

  // Pins
  pinMode(RELAY_PIN,     OUTPUT); digitalWrite(RELAY_PIN, HIGH);  // Relay OFF (active LOW)
  pinMode(BUZZER_PIN,    OUTPUT); digitalWrite(BUZZER_PIN, LOW);
  pinMode(LED_RED_PIN,   OUTPUT); digitalWrite(LED_RED_PIN, LOW);
  pinMode(LED_GREEN_PIN, OUTPUT); digitalWrite(LED_GREEN_PIN, LOW);
  pinMode(FLAME_PIN,     INPUT);

  dht.begin();

  // Build MQTT topics
  TOPIC_TELEMETRY = "sfdaass/devices/" + String(DEVICE_CODE) + "/telemetry";
  TOPIC_COMMAND   = "sfdaass/devices/" + String(DEVICE_CODE) + "/command";
  TOPIC_STATUS    = "sfdaass/devices/" + String(DEVICE_CODE) + "/status";

  connectWiFi();
  connectMQTT();

  publishStatus(true);
  blinkLED(LED_GREEN_PIN, 3);
  Serial.println("[SFDAASS] Device initialized: " + String(DEVICE_CODE));
}

// ── MAIN LOOP ────────────────────────────────────────────────────
void loop() {
  // Maintain connections
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  // Read GPS
  while (gpsSerial.available()) gps.encode(gpsSerial.read());

  unsigned long now = millis();

  // Sensor reading
  if (now - lastReadTime >= READ_INTERVAL_MS) {
    lastReadTime = now;
    readSensors();
    evaluateFireCondition();
    updateLEDs();
  }

  // Upload to backend
  if (now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;
    sendViaMQTT();
    sendViaHTTP();
  }
}

// ── SENSOR READING ───────────────────────────────────────────────
void readSensors() {
  // MQ-2 Smoke (analog, convert ADC to ppm)
  int rawSmoke = analogRead(MQ2_PIN);
  data.smoke_ppm = map(rawSmoke, 0, 4095, 0, 1000);  // Simplified; calibrate for your sensor

  // Gas sensor
  int rawGas = analogRead(GAS_PIN);
  data.gas_ppm = map(rawGas, 0, 4095, 0, 1000);

  // DHT11
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) data.temperature_c = t;
  if (!isnan(h)) data.humidity_pct = h;

  // Flame sensor (LOW = flame detected for most modules)
  data.flame_detected = (digitalRead(FLAME_PIN) == LOW);

  // GPS
  if (gps.location.isUpdated() && gps.location.isValid()) {
    data.gps_lat   = gps.location.lat();
    data.gps_lng   = gps.location.lng();
    data.gps_valid = true;
    data.gps_accuracy = gps.hdop.isValid() ? gps.hdop.value() / 100.0 : 0;
  }

  // WiFi RSSI
  data.rssi = WiFi.RSSI();

  // Uptime
  data.uptime = (millis() - bootTime) / 1000;

  Serial.printf("[SENSOR] Smoke:%.0fppm Temp:%.1f°C Gas:%.0fppm Flame:%d\n",
    data.smoke_ppm, data.temperature_c, data.gas_ppm, data.flame_detected);
}

// ── FIRE CONDITION EVALUATION ────────────────────────────────────
void evaluateFireCondition() {
  bool fireCritical = (data.smoke_ppm >= SMOKE_CRITICAL && data.temperature_c >= TEMP_CRITICAL)
                   || (data.flame_detected && data.smoke_ppm >= SMOKE_WARNING)
                   || (data.temperature_c >= TEMP_CRITICAL);

  bool fireWarning = (data.smoke_ppm >= SMOKE_WARNING)
                  || (data.temperature_c >= TEMP_WARNING)
                  || (data.gas_ppm >= GAS_WARNING);

  if (fireCritical) {
    activateSprinkler();
    activateAlarm();
    Serial.println("[FIRE] CRITICAL — Sprinkler + Alarm activated!");
  } else if (fireWarning) {
    activateAlarm();
    Serial.println("[FIRE] WARNING — Alarm activated");
  } else {
    if (alarmActive) deactivateAlarm();
  }
}

// ── ACTUATOR CONTROL ─────────────────────────────────────────────
void activateSprinkler() {
  if (!sprinklerActive) {
    digitalWrite(RELAY_PIN, LOW);  // Active LOW relay
    sprinklerActive = true;
    Serial.println("[SPRINKLER] ACTIVATED");
  }
}

void deactivateSprinkler() {
  if (sprinklerActive) {
    digitalWrite(RELAY_PIN, HIGH);
    sprinklerActive = false;
    Serial.println("[SPRINKLER] DEACTIVATED");
  }
}

void activateAlarm() {
  if (!alarmActive) {
    tone(BUZZER_PIN, 2400);  // 2400 Hz alarm tone
    alarmActive = true;
  }
}

void deactivateAlarm() {
  noTone(BUZZER_PIN);
  alarmActive = false;
}

void updateLEDs() {
  bool danger = (data.smoke_ppm >= SMOKE_WARNING) || (data.temperature_c >= TEMP_WARNING) || data.flame_detected;
  digitalWrite(LED_RED_PIN,   danger ? HIGH : LOW);
  digitalWrite(LED_GREEN_PIN, danger ? LOW  : HIGH);
}

void blinkLED(int pin, int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(pin, HIGH); delay(150);
    digitalWrite(pin, LOW);  delay(150);
  }
}

// ── MQTT ─────────────────────────────────────────────────────────
void connectMQTT() {
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setKeepAlive(60);

  Serial.print("[MQTT] Connecting...");
  String clientId = "SFDAASS_" + String(DEVICE_CODE) + "_" + String(millis());

  int retries = 0;
  while (!mqtt.connected() && retries < 5) {
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println(" Connected!");
      mqtt.subscribe(TOPIC_COMMAND.c_str(), 1);
      publishStatus(true);
    } else {
      Serial.print(".");
      delay(2000);
      retries++;
    }
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.println("[MQTT CMD] " + msg);

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, msg) != DeserializationError::Ok) return;

  const char* action = doc["action"];
  if (!action) return;

  if (strcmp(action, "activate_sprinkler") == 0)   activateSprinkler();
  else if (strcmp(action, "deactivate_sprinkler") == 0) deactivateSprinkler();
  else if (strcmp(action, "activate_alarm") == 0)  activateAlarm();
  else if (strcmp(action, "deactivate_alarm") == 0) deactivateAlarm();
  else if (strcmp(action, "reboot") == 0)           ESP.restart();
  else if (strcmp(action, "status") == 0)           publishStatus(true);
}

void sendViaMQTT() {
  if (!mqtt.connected()) return;

  StaticJsonDocument<512> doc;
  doc["device_code"]    = DEVICE_CODE;
  doc["smoke_ppm"]      = round(data.smoke_ppm * 10) / 10.0;
  doc["temperature_c"]  = round(data.temperature_c * 10) / 10.0;
  doc["gas_ppm"]        = round(data.gas_ppm * 10) / 10.0;
  doc["humidity_pct"]   = round(data.humidity_pct * 10) / 10.0;
  doc["flame_detected"] = data.flame_detected;
  if (data.gps_valid) {
    doc["gps_lat"]       = data.gps_lat;
    doc["gps_lng"]       = data.gps_lng;
    doc["gps_accuracy_m"]= data.gps_accuracy;
  }
  doc["rssi"]           = data.rssi;
  doc["battery_pct"]    = data.battery_pct;
  doc["uptime_seconds"] = data.uptime;

  char payload[512];
  serializeJson(doc, payload);
  mqtt.publish(TOPIC_TELEMETRY.c_str(), payload, true);
  Serial.println("[MQTT] Telemetry published");
}

void publishStatus(bool online) {
  if (!mqtt.connected()) return;
  StaticJsonDocument<64> doc;
  doc["online"] = online;
  char payload[64];
  serializeJson(doc, payload);
  mqtt.publish(TOPIC_STATUS.c_str(), payload, true);
}

// ── HTTP ─────────────────────────────────────────────────────────
void sendViaHTTP() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_API_KEY);
  http.setTimeout(8000);

  StaticJsonDocument<512> doc;
  doc["smoke_ppm"]      = data.smoke_ppm;
  doc["temperature_c"]  = data.temperature_c;
  doc["gas_ppm"]        = data.gas_ppm;
  doc["humidity_pct"]   = data.humidity_pct;
  doc["flame_detected"] = data.flame_detected;
  if (data.gps_valid) {
    doc["gps_lat"] = data.gps_lat;
    doc["gps_lng"] = data.gps_lng;
    doc["gps_accuracy_m"] = data.gps_accuracy;
  }
  doc["rssi"]           = data.rssi;
  doc["battery_pct"]    = data.battery_pct;
  doc["uptime_seconds"] = data.uptime;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code == 200) {
    Serial.println("[HTTP] Reading sent OK");
  } else {
    Serial.printf("[HTTP] Failed: %d\n", code);
  }
  http.end();
}

// ── WiFi ─────────────────────────────────────────────────────────
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("[WiFi] Connecting to " + String(WIFI_SSID));
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    delay(500); Serial.print("."); retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" Connected! IP: " + WiFi.localIP().toString());
    digitalWrite(LED_GREEN_PIN, HIGH);
  } else {
    Serial.println(" FAILED — will retry");
  }
}
