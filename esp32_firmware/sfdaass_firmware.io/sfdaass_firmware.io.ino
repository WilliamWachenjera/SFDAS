#include <ESP8266WiFi.h>
#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>

const char* ssid = "Chiko";
const char* password="chikondi";


const char*MQTT_HOST="069d5c04bf7347f8b2239ffe32a64225.s1.eu.hivemq.cloud";
const int MQTT_PORT= 8883;
const char* MQTT_USER ="sfdaass_device";
const char* MQTT_PASS= "Sfdaass@2026";

const char* DEVICE_CODE ="ESP32-001";

WiFiClientSecure espClient;
PubSubClient client(espClient);




//PINS (ESP8266 Specific) 
#define SMOKE_PIN A0       
#define RELAY_PIN D6      
#define DHT_PIN   D4  
#define BUZZER_PIN D5  
#define FLAME_PIN D7  

#define DHTTYPE DHT11

DHT dht(DHT_PIN, DHTTYPE);

//THRESHOLDS 
int smokeThreshold = 20;   // Adjusted for ESP8266 10-bit ADC (0-1023)
float tempThreshold = 27.0;
float humidityThreshold=60.0;

//VARIABLES 
int smokeValue;
float temperature;
float humidity;
int flameState;

bool fireDetected = false;
int confirmCount = 0;


void setup_wifi() {
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(" ");
  }

  Serial.println("\nWiFi CONNECTED");
}

void callback(char* topic, byte* payload, unsigned int length) {

  String message = "";

  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.print("Message received: ");
  Serial.println(message);

  // 🔘 MANUAL SPRINKLER CONTROL
  if (String(topic) == "fire/sprinkler/control") {

    manualOverride = true; //  user takes control

    if (message == "ON") {
      digitalWrite(RELAY_PIN, HIGH);
      client.publish("fire/sprinkler", "MANUAL ON");
      Serial.println(" Sprinkler manually ON");
    }

    else if (message == "OFF") {
      digitalWrite(RELAY_PIN, LOW);
      client.publish("fire/sprinkler", "MANUAL OFF");
      Serial.println("Sprinkler manually OFF");
    }

    // Optional: return to auto mode
    else if (message == "AUTO") {
      manualOverride = false;
      client.publish("fire/sprinkler", "AUTO MODE");
      Serial.println(" Back to AUTO mode");
    }
  }
}

void reconnect() {
     while (!client.connected()) {
    Serial.println("Connecting to MQTT...");

    if (client.connect(DEVICE_CODE, MQTT_USER, MQTT_PASS)) {
      Serial.println("MQTT Connected!");
    
      //SUBSCRIBE TO CONTROL TOPIC
      client.subscribe("fire/sprinkler/control");

      client.publish("fire/status", "device online");

    }

    else {
      Serial.print("Failed, rc=");
      Serial.print(client.state());
      Serial.println(" retrying...");
      delay(2000);
    }
  }

}

void setup() {
  Serial.begin(115200);

  // Note: A0 is input by default on ESP8266
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(FLAME_PIN, INPUT);
  


  digitalWrite(RELAY_PIN, LOW); // Keep relay off at start
  digitalWrite(BUZZER_PIN, LOW);

  dht.begin();

  setup_wifi();
   espClient.setInsecure(); // NOTE: skips certificate validation (OK for student projects)

  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);

  Serial.println("System Ready...");
}
 

void loop() {
  
if (!client.connected()) {
    reconnect();
  }
  client.loop();


  // Read sensors
  smokeValue = analogRead(SMOKE_PIN);
  temperature = dht.readTemperature();
  humidity = dht.readHumidity();
  FlameState = digitalRead(FLAME_PIN);

// CHCK SENSOR ERROR
   if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT Sensor error!");
    delay(2000);
    return;
  }

  //        MQTT PUBLISH   


  char msg[50];

  sprintf(msg, "%d", smokeValue);
  client.publish("fire/smoke", msg);

  sprintf(msg, "%.2f", temperature);
  client.publish("fire/temperature", msg);

  sprintf(msg, "%.2f", humidity);
  client.publish("fire/humidity", msg);

  sprintf(msg," %.d", flamState);
  client.publish("fire/fame", msg);





  Serial.println("------ DATA ------");
  Serial.print("Smoke: "); Serial.println(smokeValue);
  Serial.print("Temp: ");  Serial.print(temperature); Serial.println("°C");
  Serial.print("Hum:  ");  Serial.print(humidity);    Serial.println("%");
  Serial.print("Flame: "); Serial.prinln(flameState==LOW ? "DETECTED" : "NONE");
  // Check sensor error
 

  //DEBUG WARNING
  if(smokeValue > smokeThreshold){
    Serial.println(" smoke detected");
  }

  if (temperature> tempThreshold){
    Serial.println("temperature levels high");
  }

  if (humidity>humidityThreshold){
    Serial.println("the humidity is high" );
  }

  //   ALERT FLAGS(FIXED)


  bool smokeAlert = smokeValue > smokeThreshold;
  bool tempAlert = temperature > tempThreshold;
  bool humidityAlert= humidity > humidityThreshold;
  boolflameAlert = (flameState == LOW);


  // Detection logic

  if(!manualOverride){

    if (smokeAlert || tempAlert || flameAlert) 
    {
     confirmCount++;
    }
    else {
    confirmCount = 0;
    }

    Serial.print("Confirm Count:");
    Serial.println(confirmCount);

  // Confirm fire (must happen 3 times)


    if (confirmCount >= 3) {
      fireDetected = true;
      client.publish("fire/alerts","fire detected");

      digitalWrite(RELAY_PIN, HIGH);
      digitalWrite(BUZZER_PIN, HIGH);

      client.publish("fire/sprinkler","SPRINKLER ACTIVATED");

      Serial.println("fire confirmed - SPRINKER ON");
    } 
    else {
    fireDetected = false;

    digitalWrite(RELAY_PIN, LOW);
    digitalWrite(BUZZER_PIN,LOW);

    }

  } // Action

  if (manualOverrise){

    serial.println("manual mode active");
  }  

  else if (fireDetected) {
    Serial.println(" FIRE ACTIVE");

  }
  
  else {
    Serial.println("System Normal");
    
  }

  delay(6000);
}


