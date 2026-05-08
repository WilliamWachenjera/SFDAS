#include<ESP8266WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
const char* ssid = "your_wifi_name";
const char* password="your_wifi password";

const char* mqtt_server = "broker.hivemq.com";
WiFiClient espClient;
PubSubClient client(espClient);


//PINS (ESP8266 Specific) 
#define SMOKE_PIN A0       
#define RELAY_PIN D6      
#define DHT_PIN   D4  
#define BUZZER_PIN D5    

#define DHTTYPE DHT11

DHT dht(DHT_PIN, DHTTYPE);

//THRESHOLDS 
int smokeThreshold = 400;   // Adjusted for ESP8266 10-bit ADC (0-1023)
float tempThreshold = 50.0;
float humidityThreshold=78.0;

//VARIABLES 
int smokeValue;
float temperature;
float humidity;

bool fireDetected = false;
int confirmCount = 0;


void setup_wifi() {
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void reconnect() {
  while (!client.connected()) {
    client.connect("ESP8266FireClient");
  }
}

void setup() {
  Serial.begin(115200);

  // Note: A0 is input by default on ESP8266
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  


  digitalWrite(RELAY_PIN, LOW); // Keep relay off at start
  digitalWrite(BUZZER_PIN, LOW);

  dht.begin();

  setup_wifi();
  client.setServer(mqtt_server, 1883);

  Serial.println("ESP8266 Fire Detection System Ready...");
  Serial.println("fire detection system started");
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
  char msg[50];

  sprintf(msg, "%d", smokeValue);
  client.publish("fire/smoke", msg);

  sprintf(msg, "%.2f", temperature);
  client.publish("fire/temperature", msg);






  Serial.println("------ DATA ------");
  Serial.print("Smoke: "); Serial.println(smokeValue);
  Serial.print("Temp: ");  Serial.print(temperature); Serial.println("°C");
  Serial.print("Hum:  ");  Serial.print(humidity);    Serial.println("%");

  // Check sensor error
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT Sensor error!");
    delay(2000);
    return;
  }

  //DEBUG WARNING
  if(smokeValue > smokeThreshold){
    Serial.println(" smoke detected");
  }

  if (temperature> tempThreshold){
    Serial.println("temperature levels high");
  }

  if (humidity>humidityThreshold){
    Serial.println("the humidity is high or decreasing");
  }

  // Detection logic
  if (smokeValue > smokeThreshold || (temperature > tempThreshold &&  humidity>humidityThreshold)) {
    confirmCount++;
  } else {
    confirmCount = 0;
  }

  // Confirm fire (must happen 3 times)
  if (confirmCount >= 3) {
    fireDetected = true;
    client.publish("fire/alerts","fire detected");
    digitalWrite(RELAY_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    
  } else {
    fireDetected = false;
  }

  // Action
  if (fireDetected) {
    Serial.println("🔥 FIRE CONFIRMED!");
    digitalWrite(RELAY_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
  } else {
    Serial.println("System Normal");
    digitalWrite(RELAY_PIN, LOW);
    digitalWrite(BUZZER_PIN,LOW);
  }

  delay(2000);
}


