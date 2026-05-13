#Smart Fire Detection and Alert System (SFDAAS)

##Project Overview
This project is an IoT-based Fire Detection and Alert System designed to detect fire conditions using smoke and temperature sensors. When a fire is detected, the system activates a buzzer and a relay-controlled output (such as a water pump) to respond immediately.

The system is built using ESP8266 and programmed using Arduino IDE.

##Objectives
- Detect fire using smoke and temperature sensors
- Monitor environmental conditions (temperature & humidity)
- Trigger alarm when fire is detected
- Activate relay to control external devices (pump/buzzer)
- Reduce false alarms using confirmation logic

##How It Works
1. The system reads data from sensors:
   - Smoke sensor (MQ series)
   - Temperature and humidity sensor (DHT11)

2. The data is compared with threshold values.

3. If abnormal conditions are detected:
   - Fire condition is confirmed after repeated detection
   - Buzzer is activated
   - Relay is turned ON (to control pump or safety system)
     
##Hardware Components
- ESP8266 Microcontroller
- MQ Smoke Sensor
- DHT11 Temperature & Humidity Sensor
- Relay Module
- Buzzer
- Jumper Wires
- Power Supply

##Software Used
- Arduino IDE
- C/C++ Programming Language
- ESP8266 Board Package

##Pin Configuration
- Smoke Sensor → A0  
- DHT11 → D2 
- Relay → D5 
- Buzzer → D6  

##System Logic
- If smoke OR temperature exceeds threshold,possible fire detected
- System confirms detection multiple times
- Relay and buzzer are activated when fire is confirmed

##How to Run
1. Install Arduino IDE
2. Install ESP8266 board package
3. Install DHT library
4. Connect hardware components
5. Upload the code
6. Open Serial Monitor (115200 baud)
