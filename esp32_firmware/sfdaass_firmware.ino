#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <TinyGPS++.h>
#include <SoftwareSerial.h>

// ================== WIFI & MQTT ==================
const char* ssid = "Airtel_4G_SMARTCONNECT_8209";
const char* password = "7A92A762";

const char* MQTT_HOST = "069d5c04bf7347f8b2239ffe32a64225.s1.eu.hivemq.cloud";
const int MQTT_PORT = 8883;
const char* MQTT_USER = "sfdaass_device";
const char* MQTT_PASS = "Sfdaass@2026";

const char* DEVICE_CODE = "ESP8266-001";

// ================== GPS ==================
TinyGPSPlus gps;
SoftwareSerial gpsSerial(D2, D1); // RX, TX

// ================== PINS ==================
#define SMOKE_PIN A0
#define RELAY_PIN D6
#define DHT_PIN   D4
#define BUZZER_PIN D5
#define FLAME_PIN D7
#define DHTTYPE DHT11

DHT dht(DHT_PIN, DHTTYPE);

WiFiClientSecure espClient;
PubSubClient client(espClient);

// ================== VARIABLES ==================
int smokeValue;
float temperature;
float humidity;
int flameState;

bool manualOverride = false;

// Thresholds
int smokeThreshold = 22;
float tempThreshold = 12.0;

// 🔴 Adjust if needed
#define FLAME_TRIGGER_STATE HIGH

// ================== FIRE CONTROL ==================
int confirmCount = 0;
bool confirmedFire = false;

bool suppressionActive = false;
unsigned long suppressionStart = 0;
const int SUPPRESSION_TIME = 10000; // 10 seconds

// ================== WIFI ==================
void setupWiFi() {
  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected!");
}

// ================== MQTT CALLBACK ==================
void callback(char* topic, byte* payload, unsigned int length) {
  String message;

  for (int i = 0; i < length; i++) message += (char)payload[i];

  Serial.print("MQTT Message: ");
  Serial.println(message);

  if (strstr(topic, "sprinkler")) {
    manualOverride = true;

    if (message == "ON") {
      digitalWrite(RELAY_PIN, HIGH);
      digitalWrite(BUZZER_PIN, HIGH);
      Serial.println("MANUAL ON");
    }
    else if (message == "OFF") {
      digitalWrite(RELAY_PIN, LOW);
      digitalWrite(BUZZER_PIN, LOW);
      Serial.println("MANUAL OFF");
    }
    else if (message == "AUTO") {
      manualOverride = false;
      Serial.println("AUTO MODE");
    }
  }
}

// ================== MQTT RECONNECT ==================
void reconnect() {
  while (!client.connected()) {
    Serial.print("Connecting MQTT...");

    if (client.connect(DEVICE_CODE, MQTT_USER, MQTT_PASS)) {
      Serial.println("Connected!");

      String sub = "sfdaass/sprinkler/" + String(DEVICE_CODE);
      client.subscribe(sub.c_str());

      String status = "sfdaass/status/" + String(DEVICE_CODE);
      client.publish(status.c_str(), "ONLINE");
    }
    else {
      Serial.print("Failed rc=");
      Serial.println(client.state());
      delay(3000);
    }
  }
}

// ================== SETUP ==================
void setup() {
  Serial.begin(115200);

  gpsSerial.begin(9600);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(FLAME_PIN, INPUT_PULLUP);

  digitalWrite(RELAY_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  dht.begin();
  setupWiFi();

  espClient.setInsecure();

  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);

  Serial.println("System Ready...");
}

// ================== LOOP ==================
void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  // Read GPS
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }

  static unsigned long lastPublish = 0;

  if (millis() - lastPublish > 5000) {
    lastPublish = millis();

    // Read sensors
    smokeValue = analogRead(SMOKE_PIN);
    temperature = dht.readTemperature();
    humidity = dht.readHumidity();
    flameState = digitalRead(FLAME_PIN);

    if (isnan(temperature) || isnan(humidity)) return;

    // ================== FIRE LOGIC ==================
    bool smokeAlert = (smokeValue > smokeThreshold);
    bool flameDetected = (flameState == FLAME_TRIGGER_STATE);

    bool rawFire = (smokeAlert && flameDetected);

    // CONFIRM FIRE
    if (rawFire) {
      confirmCount++;
    } else {
      confirmCount = 0;
    }

    confirmedFire = (confirmCount >= 3);

    // ================== SUPPRESSION ==================
    if (confirmedFire && !manualOverride && !suppressionActive) {
      suppressionActive = true;
      suppressionStart = millis();
      Serial.println("there is fire .there is fire");

      digitalWrite(RELAY_PIN, HIGH);
      digitalWrite(BUZZER_PIN, HIGH);

      client.publish("sfdaass/suppression/status", "ON");
    }

    // KEEP RUNNING
    if (suppressionActive) {
      if (millis() - suppressionStart > SUPPRESSION_TIME) {
        suppressionActive = false;

        digitalWrite(RELAY_PIN, LOW);
        digitalWrite(BUZZER_PIN, LOW);

        client.publish("sfdaass/suppression/status", "OFF");
      }
    }

    // SAFE OFF
    if (!confirmedFire && !manualOverride && !suppressionActive) {
      digitalWrite(RELAY_PIN, LOW);
      digitalWrite(BUZZER_PIN, LOW);
    }

    // ================== GPS ==================
    double lat = gps.location.isValid() ? gps.location.lat() : 0.0;
    double lon = gps.location.isValid() ? gps.location.lng() : 0.0;

    // ================== JSON ==================
    char payload[256];

    snprintf(payload, sizeof(payload),
      "{\"device\":\"%s\",\"smoke\":%d,\"temp\":%.2f,\"humidity\":%.2f,\"flame\":%s,\"fire\":%s,\"lat\":%.6f,\"lon\":%.6f}",
      DEVICE_CODE,
      smokeValue,
      temperature,
      humidity,
      flameDetected ? "true" : "false",
      confirmedFire ? "true" : "false",
      lat,
      lon
    );

    String topic = "sfdaass/sensors/" + String(DEVICE_CODE);
    client.publish(topic.c_str(), payload);

    // FIRE ALERT
    if (confirmedFire) {
      String alert = "sfdaass/alerts/" + String(DEVICE_CODE);
      client.publish(alert.c_str(), "FIRE DETECTED");
    }

    // ================== DEBUG ==================
    Serial.println("------ SYSTEM DEBUG ------");
    Serial.print("Smoke: "); Serial.println(smokeValue);
    Serial.print("Temp: "); Serial.println(temperature);
    Serial.print("Flame: "); Serial.println(flameDetected);
    Serial.print("Confirmed Fire: "); Serial.println(confirmedFire);
    Serial.print("Suppression: "); Serial.println(suppressionActive);
    Serial.println("--------------------------");

    Serial.println(payload);
  }
}