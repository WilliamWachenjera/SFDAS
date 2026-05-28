#include <ESP8266WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <TinyGPS++.h>
#include <SoftwareSerial.h>
#include <ArduinoJson.h>

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
SoftwareSerial gpsSerial(D2, D1);

//GSM...............

SoftwareSerial gsmSerial(D3, D8 );//RX TX
const char* PHONE_NUMBER ="+265981597512";
bool smsSent=false;


// ================== PINS ==================
#define SMOKE_PIN A0

#define DHT_PIN   D4
#define BUZZER_PIN D5
#define FLAME_PIN D7
#define RELAY_PIN D6
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
bool pumpState = false;

// Thresholds
int smokeThreshold = 60;
float tempThreshold = 27.0;

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

  for (unsigned int i = 0; i < length; i++) message += (char)payload[i];

  Serial.print("MQTT Message [");
  Serial.print(topic);
  Serial.print("]: ");
  Serial.println(message);

  if (strstr(topic, "sprinkler")) {
    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, message);

    if (!error) {
      if (doc.containsKey("activate")) {
        bool activate = doc["activate"];
        manualOverride = true;
        if (activate) {
          Serial.println("JSON MANUAL ON");
          pumpState = true;
          digitalWrite(RELAY_PIN, LOW); // Active LOW relay ON
          digitalWrite(BUZZER_PIN, HIGH);
        } else {
          Serial.println("JSON MANUAL OFF");
          pumpState = false;
          digitalWrite(RELAY_PIN, HIGH); // Active LOW relay OFF
          digitalWrite(BUZZER_PIN, LOW);
          manualOverride = false;
        }
      }
    } else {
      manualOverride = true;
      if (message == "ON") {
        Serial.println("ON");
        pumpState = true;
        digitalWrite(RELAY_PIN, LOW); // Active LOW relay ON
        digitalWrite(BUZZER_PIN, HIGH);
      }
      else if (message == "OFF") {
        Serial.println("OFF");
        pumpState = false;
        digitalWrite(RELAY_PIN, HIGH); // Active LOW relay OFF
        digitalWrite(BUZZER_PIN, LOW);
        Serial.println("MANUAL OFF");
      }
      else if (message == "AUTO") {
        manualOverride = false;
        Serial.println("AUTO MODE");
      }
    }
  }
}

// ================== MQTT RECONNECT ==================
void reconnect() {
  while(!client.connected()) {

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


//...............SEND SMS..........
void sendSMS(String message){
  gsmSerial.println("AT+CMGF=1");
  delay(1000);

  gsmSerial.print("AT+CMGS=\"");
  gsmSerial.print(PHONE_NUMBER);
  gsmSerial.println("\"");
  delay(1000);

  gsmSerial.print(message);
  delay(500);

  gsmSerial.write(26); // CTRL+Z
  delay(3000);

  Serial.println("SMS SENT!");
}
// ================== SETUP ==================
void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600);

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // Active LOW relay OFF

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(FLAME_PIN, INPUT_PULLUP);

  digitalWrite(BUZZER_PIN, LOW);

  dht.begin();
  setupWiFi();

  espClient.setInsecure();

  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);
  
  //GSM INIT
  Serial.println("Initializing GSM...");
  delay(2000);
  gsmSerial.println("AT");
  delay(1000);
  gsmSerial.println("AT+CMGF=1");

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
  if (confirmedFire) {
        static unsigned long lastAlert = 0;
        // Send alert every 5 seconds, not every loop (to avoid spam)
        if (millis() - lastAlert > 5000) {
            lastAlert = millis();
            String alert = "sfdaass/alerts/" + String(DEVICE_CODE);
            if(client.publish(alert.c_str(), "FIRE DETECTED")) {
                Serial.println("✅ ALERT SENT!");
            } else {
                Serial.println("❌ ALERT FAILED - MQTT disconnected?");
            }
        }
    }

  static unsigned long lastPublish = 0;

  if (millis() - lastPublish > 1000) { // THIS IS A 1 minutes
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
    bool tempAlert=(temperature > tempThreshold);

    bool rawFire =(
       (smokeAlert && flameDetected) ||
       (smokeAlert && tempAlert) ||
       (tempAlert && flameDetected)
    );

    // CONFIRM FIRE

    if (rawFire) {
      confirmCount++;
    } else {
      confirmCount = 0;
    }

    confirmedFire = (confirmCount >= 3);

    // ================== SUPPRESSION ==================
    if (confirmedFire && !manualOverride && !pumpState) {
      Serial.println("ON");
      pumpState = true;
      suppressionActive = true;
      suppressionStart = millis();
      digitalWrite(RELAY_PIN, LOW); // Active LOW relay ON
      
      Serial.println("there is fire .there is fire");

      digitalWrite(BUZZER_PIN, HIGH);

      client.publish("sfdaass/suppression/status", "ON");
    

       // 🔥 SEND SMS
      if (!smsSent) {
        String smsMessage = "🔥 FIRE ALERT!\nDevice: " + String(DEVICE_CODE);

        if (gps.location.isValid()) {
          smsMessage += "\nLat: " + String(gps.location.lat(), 6);
          smsMessage += "\nLon: " + String(gps.location.lng(), 6);
          smsMessage += "\nhttps://maps.google.com/?q=";
          smsMessage += String(gps.location.lat(), 6);
          smsMessage += ",";
          smsMessage += String(gps.location.lng(), 6);
        }

        sendSMS(smsMessage);
        smsSent = true;
      }
    }

    // KEEP RUNNING or extend if the fire is still active
    if (suppressionActive) {
      if(confirmedFire){
        suppressionStart = millis();//extend
      }

      if (millis() - suppressionStart > SUPPRESSION_TIME) {
        suppressionActive = false;
        pumpState = false;

        digitalWrite(RELAY_PIN, HIGH); // Active LOW relay OFF
        digitalWrite(BUZZER_PIN, LOW);

        client.publish("sfdaass/suppression/status", "OFF");
      }
    }

    // SAFE OFF
    if (!confirmedFire && !manualOverride && !suppressionActive) {
      digitalWrite(RELAY_PIN, HIGH); // Active LOW relay OFF
      digitalWrite(BUZZER_PIN, LOW);
      pumpState = false;
    }

    // ================== GPS ==================
    double lat = gps.location.isValid() ? gps.location.lat() : 0.0;
    double lon = gps.location.isValid() ? gps.location.lng() : 0.0;

    // ================== JSON ==================
    char payload[512];

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
    if(client.publish(topic.c_str(), payload)){
      Serial.println("sent to broker");

    } else{
      Serial.println("fail to send");
    }
  

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