// SMART FIRE DETECTION SYSTEM
// FOR NODEMCU (ESP8266)
// Sensors work even if WiFi fails

#include <DHT.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>

// ===== WiFi SETTINGS =====
// CHANGE THESE TO YOUR ACTUAL WiFi
const char* ssid = "yor wifi name";      // Change this
const char* password = "YOUR_PASSWORD";   // Change this

// ===== BACKEND SERVER =====
const char* serverUrl = "http://YOUR_SERVER_IP:5000/api/fire";

// ===== PIN DEFINITIONS =====
const int smoke_pin = A0;    // MQ-2 smoke sensor
const int relay_pin = 0;     // D3 = GPIO0 for relay
const int buzzer_pin = 2;    // D4 = GPIO2 for buzzer

// ===== DHT22 SETUP =====
#define DHTPIN 4              // D2 = GPIO4 for DHT22
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

// ===== THRESHOLDS =====
const int smoke_threshold = 70;
const float temp_threshold = 50.0;

// Variables
bool wifiConnected = false;
WiFiClient client;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  // Set pin modes
  pinMode(smoke_pin, INPUT);
  pinMode(relay_pin, OUTPUT);
  pinMode(buzzer_pin, OUTPUT);
  
  // Start with sprinkler and buzzer OFF
  digitalWrite(relay_pin, LOW);
  digitalWrite(buzzer_pin, LOW);
  
  // Start DHT22 sensor
  dht.begin();
  
  // Try to connect to WiFi (but don't get stuck forever)
  Serial.println("==========================================");
  Serial.println("   FIRE DETECTION SYSTEM");
  Serial.println("   NodeMCU + Smoke + Temperature");
  Serial.println("==========================================");
  
  Serial.print("Attempting WiFi connection to: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  Serial.println();
  
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("✅ WiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    wifiConnected = false;
    Serial.println("⚠️ WiFi NOT connected!");
    Serial.println("   (Sensors will still work, but no internet alerts)");
  }
  
  Serial.println("==========================================");
  Serial.println("SYSTEM READY - Monitoring for fire");
  Serial.println("==========================================");
}

void loop() {
  // ===== READ SENSORS (ALWAYS WORKS) =====
  int smoke = analogRead(smoke_pin);
  float temp = dht.readTemperature();
  
  // Check if DHT22 reading failed
  if (isnan(temp)) {
    temp = 25.0;  // Default value
  }
  
  // ===== CHECK FOR FIRE =====
  bool fireDetected = (smoke > smoke_threshold) || (temp >= temp_threshold);
  
  // ===== PRINT EVERYTHING TO SERIAL MONITOR =====
  Serial.println("----------------------------------------");
  Serial.print("💨 SMOKE: ");
  Serial.print(smoke);
  Serial.print("  |  🌡️ TEMP: ");
  Serial.print(temp);
  Serial.println(" °C");
  
  // Show WiFi status
  if (wifiConnected) {
    Serial.print("📡 WiFi: Connected");
  } else {
    Serial.print("📡 WiFi: NOT Connected (no internet alerts)");
  }
  Serial.println();
  
  // ===== CONTROL OUTPUTS =====
  if (fireDetected) {
    digitalWrite(relay_pin, HIGH);   // Sprinkler ON
    digitalWrite(buzzer_pin, HIGH);  // Buzzer ON
    
    Serial.println("🔥🔥🔥 FIRE DETECTED! 🔥🔥🔥");
    Serial.println("💧 Sprinkler ACTIVATED");
    Serial.println("🔊 Buzzer SOUNDING");
    
    if (smoke > smoke_threshold) {
      Serial.print("   → Smoke level: ");
      Serial.print(smoke);
      Serial.println(" (ABOVE THRESHOLD)");
    }
    if (temp >= temp_threshold) {
      Serial.print("   → Temperature: ");
      Serial.print(temp);
      Serial.println(" °C (ABOVE THRESHOLD)");
    }
    
    // Try to send to server only if WiFi connected
    if (wifiConnected) {
      sendToServer(smoke, temp, true);
    } else {
      Serial.println("⚠️ Cannot send alert - WiFi not connected");
    }
    
  } else {
    digitalWrite(relay_pin, LOW);    // Sprinkler OFF
    digitalWrite(buzzer_pin, LOW);   // Buzzer OFF
    
    Serial.println("✅ SYSTEM SAFE - No fire detected");
    Serial.print("   Smoke threshold: ");
    Serial.print(smoke_threshold);
    Serial.print("  |  Temp threshold: ");
    Serial.print(temp_threshold);
    Serial.println(" °C");
  }
  
  Serial.println("----------------------------------------");
  delay(7000);  // Wait 2 seconds
}

// ===== FUNCTION TO SEND DATA TO BACKEND =====
void sendToServer(int smoke, float temp, bool fire) {
  if (!wifiConnected) {
    return;
  }
  
  HTTPClient http;
  http.begin(client, serverUrl);
  http.addHeader("Content-Type", "application/json");
  
  String json = "{";
  json += "\"smoke\":" + String(smoke) + ",";
  json += "\"temperature\":" + String(temp) + ",";
  json += "\"fire\":" + String(fire);
  json += "}";
  
  Serial.print("📡 Sending to server: ");
  Serial.println(json);
  
  int response = http.POST(json);
  
  if (response > 0) {
    Serial.print("✅ Server response: ");
    Serial.println(response);
  } else {
    Serial.print("❌ Error sending data: ");
    Serial.println(response);
  }
  
  http.end();
}