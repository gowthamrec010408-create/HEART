/*
 * ==============================================================================
 * Project: IoT-Based Cardiac Health Monitoring and Early Warning System
 * Microcontroller: ESP32 DevKit V1
 * Sensors: MAX30102 (Heart Rate & SpO2) + AD8232 (Single-Lead ECG)
 * Output: USB Serial (115200 baud) & Wi-Fi WebSocket (ws://<LAPTOP_IP>:3000/ws/esp32)
 * ==============================================================================
 *
 * GPIO PINOUT ASSIGNMENTS:
 * -------------------------------------------------------------
 * MAX30102 (I2C):
 *   VIN   --> 3.3V
 *   GND   --> GND
 *   SDA   --> GPIO 21
 *   SCL   --> GPIO 22
 *
 * AD8232 (Analog ECG):
 *   3.3V  --> 3.3V
 *   GND   --> GND
 *   OUTPUT--> GPIO 34 (ADC1_CH6 - Input Only)
 *   LO+   --> GPIO 26 (Lead-Off Detection +)
 *   LO-   --> GPIO 27 (Lead-Off Detection -)
 * -------------------------------------------------------------
 *
 * REQUIRED ARDUINO LIBRARIES:
 * 1. WebSockets by Markus Sattler (v2.4.0+) -> Install via Arduino Library Manager
 * 2. ArduinoJson by Benoit Blanchon (v6.x or v7.x) -> Install via Arduino Library Manager
 * 3. WiFi.h & Wire.h -> Built into official ESP32 Arduino Core
 * ==============================================================================
 */

#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ==============================================================================
// 1. CONFIGURATION & NETWORK CREDENTIALS
// ==============================================================================
// Set your Wi-Fi credentials here (to enable Wi-Fi mode):
const char* WIFI_SSID     = "YOUR_WIFI_SSID";       // <--- Put your Wi-Fi name here
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";   // <--- Put your Wi-Fi password here

// Backend Server IP & Port (Auto-detected LAN IP of your computer running server.js):
const char* WS_SERVER_IP  = "10.235.101.1";         // <--- Computer LAN IP
const int   WS_SERVER_PORT = 3000;
const char* WS_SERVER_PATH = "/ws/esp32";

// Set to true to enable Wi-Fi (USB Serial and Wi-Fi run simultaneously):
#define ENABLE_WIFI true

// ==============================================================================
// 2. HARDWARE PIN DEFINITIONS
// ==============================================================================
#define I2C_SDA_PIN    21
#define I2C_SCL_PIN    22

#define AD8232_OUT_PIN 34
#define AD8232_LO_PLUS 26
#define AD8232_LO_MIN  27

#define MAX30102_I2C_ADDR 0x57

// MAX30102 Register Map
#define REG_INTR_STATUS_1 0x00
#define REG_INTR_STATUS_2 0x01
#define REG_INTR_ENABLE_1 0x02
#define REG_INTR_ENABLE_2 0x03
#define REG_FIFO_WR_PTR   0x04
#define REG_OVF_COUNTER   0x05
#define REG_FIFO_RD_PTR   0x06
#define REG_FIFO_DATA     0x07
#define REG_FIFO_CONFIG   0x08
#define REG_MODE_CONFIG   0x09
#define REG_SPO2_CONFIG   0x0A
#define REG_LED1_PA       0x0C // RED LED Pulse Amplitude
#define REG_LED2_PA       0x0D // IR LED Pulse Amplitude
#define REG_PART_ID       0xFF // Should return 0x15 for MAX30102

// ==============================================================================
// 3. GLOBAL VARIABLES & TIMERS
// ==============================================================================
WebSocketsClient webSocket;
bool wifiConnected = false;
bool max30102Detected = false;

// Sampling Timers (Non-blocking)
unsigned long lastEcgSampleTime = 0;
const unsigned long ECG_SAMPLE_INTERVAL_US = 4000; // 4000 us = 250 Hz sample rate

unsigned long lastVitalsProcessTime = 0;
const unsigned long VITALS_INTERVAL_MS = 100; // 10 Hz telemetry rate

unsigned long lastWifiCheckTime = 0;

// ECG Filter & Signal Variables
int rawEcgValue = 2048;
float filteredEcg = 2048.0;
bool ecgLeadOff = false;
float ecgBaseline = 2048.0;

// MAX30102 Buffers & Vitals Variables
uint32_t rawRed = 0;
uint32_t rawIr = 0;
bool fingerDetected = false;
int computedBpm = 0;
int computedSpo2 = 0;
String currentSignalQuality = "NO_FINGER";
String currentSensorStatus  = "INITIALIZING";

// Calibrated Beat Detection State for MAX30102
float irDc = 0.0;
float redDc = 0.0;
float dynamicAmplitude = 120.0;
float irMin = 1000000.0, irMax = 0.0;
float redMin = 1000000.0, redMax = 0.0;
unsigned long lastBeatTime = 0;
float rates[5] = {0};
byte rateSpot = 0;
int stableBeatCount = 0;

// ==============================================================================
// 4. MAX30102 DIRECT I2C DRIVER
// ==============================================================================
void writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MAX30102_I2C_ADDR);
  Wire.write(reg);
  Wire.write(value);
  Wire.endTransmission();
}

uint8_t readRegister(uint8_t reg) {
  Wire.beginTransmission(MAX30102_I2C_ADDR);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((uint8_t)MAX30102_I2C_ADDR, (uint8_t)1);
  if (Wire.available()) {
    return Wire.read();
  }
  return 0;
}

uint8_t getAvailableSamples() {
  uint8_t wrPtr = readRegister(REG_FIFO_WR_PTR);
  uint8_t rdPtr = readRegister(REG_FIFO_RD_PTR);
  return (wrPtr - rdPtr) & 0x1F;
}

bool initMAX30102() {
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, 400000); // 400 kHz Fast I2C
  delay(10);

  uint8_t partId = readRegister(REG_PART_ID);
  Serial.print("[ESP32] Checking MAX30102 Part ID: 0x");
  Serial.println(partId, HEX);

  // MAX30102 Part ID is 0x15 (or 0x11 for MAX30100)
  if (partId != 0x15 && partId != 0x11) {
    Serial.println("[ESP32] WARNING: MAX30102 sensor not found on I2C bus!");
    return false;
  }

  // 1. Reset MAX30102
  writeRegister(REG_MODE_CONFIG, 0x40);
  delay(50);

  // 2. Clear FIFO pointers
  writeRegister(REG_FIFO_WR_PTR, 0x00);
  writeRegister(REG_OVF_COUNTER, 0x00);
  writeRegister(REG_FIFO_RD_PTR, 0x00);

  // 3. FIFO Configuration: Sample averaging = 4, rollover enabled (0x5F)
  writeRegister(REG_FIFO_CONFIG, 0x5F);

  // 4. Mode Configuration: SpO2 mode (Red & IR active)
  writeRegister(REG_MODE_CONFIG, 0x03);

  // 5. SpO2 Configuration: ADC Range 4096nA, Sample Rate 100Hz, Pulse Width 411us (18-bit)
  writeRegister(REG_SPO2_CONFIG, 0x27);

  // 6. LED Pulse Amplitude: ~10mA for RED and IR (strong optical penetration)
  writeRegister(REG_LED1_PA, 0x32);
  writeRegister(REG_LED2_PA, 0x32);

  Serial.println("[ESP32] MAX30102 initialized successfully.");
  return true;
}

bool readMAX30102Sample(uint32_t &red, uint32_t &ir) {
  Wire.beginTransmission(MAX30102_I2C_ADDR);
  Wire.write(REG_FIFO_DATA);
  if (Wire.endTransmission(false) != 0) return false;

  // Request 6 bytes: 3 bytes RED, 3 bytes IR
  if (Wire.requestFrom((uint8_t)MAX30102_I2C_ADDR, (uint8_t)6) == 6) {
    uint8_t b1 = Wire.read();
    uint8_t b2 = Wire.read();
    uint8_t b3 = Wire.read();
    red = ((uint32_t)b1 << 16 | (uint32_t)b2 << 8 | b3) & 0x03FFFF;

    uint8_t b4 = Wire.read();
    uint8_t b5 = Wire.read();
    uint8_t b6 = Wire.read();
    ir = ((uint32_t)b4 << 16 | (uint32_t)b5 << 8 | b6) & 0x03FFFF;
    return true;
  }
  return false;
}

// ==============================================================================
// 5. VITALS PROCESSING & CALIBRATION ALGORITHM (HEART RATE & SPO2)
// ==============================================================================
void processSingleSample(uint32_t r, uint32_t i) {
  rawRed = r;
  rawIr  = i;

  // 1. Detect finger presence: raw IR threshold > 10,000 counts
  // (Ambient light without finger is typically < 3,000; finger placement is 15,000 - 80,000)
  if (rawIr < 10000) {
    fingerDetected = false;
    computedBpm = 0;
    computedSpo2 = 0;
    currentSignalQuality = "NO_FINGER";
    currentSensorStatus = "FINGER_REMOVED";
    irDc = 0; redDc = 0;
    rateSpot = 0;
    stableBeatCount = 0;
    for (int k = 0; k < 5; k++) rates[k] = 0;
    return;
  }

  fingerDetected = true;
  currentSensorStatus = "CONNECTED";

  // 2. DC tracking via Exponential Moving Average (EMA)
  if (irDc == 0) {
    irDc = rawIr;
    redDc = rawRed;
  } else {
    irDc  = 0.95 * irDc  + 0.05 * rawIr;
    redDc = 0.95 * redDc + 0.05 * rawRed;
  }

  // 3. Absorption signal (arterial blood surge causes light absorption: dip in raw photodiode)
  float irSignal  = (float)irDc  - (float)rawIr;
  float redSignal = (float)redDc - (float)rawRed;

  // Track min/max across pulse cycle
  if (rawIr < irMin) irMin = rawIr;
  if (rawIr > irMax) irMax = rawIr;
  if (rawRed < redMin) redMin = rawRed;
  if (rawRed > redMax) redMax = rawRed;

  unsigned long now = millis();

  // Dynamic beat threshold: minimum 35 counts, adaptive to pulse strength
  float threshold = max(35.0f, dynamicAmplitude * 0.40f);

  // Peak detection state machine
  static float lastIrSignal = 0.0;
  static bool rising = false;

  if (irSignal > threshold && irSignal > lastIrSignal) {
    rising = true;
  }

  // Peak reached: was rising above threshold, now starting to fall
  if (rising && irSignal < lastIrSignal && (now - lastBeatTime >= 350)) {
    rising = false;
    unsigned long delta = now - lastBeatTime;
    lastBeatTime = now;

    // Physiological valid pulse interval: 350ms (171 BPM) to 1800ms (33 BPM)
    if (delta >= 350 && delta <= 1800) {
      float instantBpm = 60000.0 / delta;

      // Filter extreme sudden outliers if we already have a stable heart rate
      bool acceptBeat = true;
      if (stableBeatCount >= 3 && abs(instantBpm - (float)computedBpm) > 40) {
        acceptBeat = false; // reject motion artifact
      }

      if (acceptBeat) {
        rates[rateSpot] = instantBpm;
        rateSpot = (rateSpot + 1) % 5;
        if (stableBeatCount < 10) stableBeatCount++;

        // Moving average of valid beats
        float sumBpm = 0;
        int validCount = 0;
        for (int k = 0; k < 5; k++) {
          if (rates[k] > 0) {
            sumBpm += rates[k];
            validCount++;
          }
        }
        if (validCount >= 1) {
          computedBpm = (int)((sumBpm / validCount) + 0.5);
        }
      }
    }

    // Measure AC amplitude for SpO2 calculation
    float acIr  = (float)(irMax - irMin);
    float acRed = (float)(redMax - redMin);

    if (acIr >= 25.0 && acRed >= 15.0 && irDc > 5000 && redDc > 5000) {
      dynamicAmplitude = 0.75 * dynamicAmplitude + 0.25 * acIr;
      float ratio = (acRed / redDc) / (acIr / irDc);

      // Physiological R ratio range for humans: 0.40 (100% SpO2) to 1.25 (~80% SpO2)
      if (ratio >= 0.40 && ratio <= 1.25) {
        // Maxim Integrated calibrated formula
        int spo2Val = (int)(104.0 - 17.0 * ratio);
        if (spo2Val > 100) spo2Val = 100;
        if (spo2Val < 85)  spo2Val = 85;

        if (computedSpo2 == 0) {
          computedSpo2 = spo2Val;
        } else {
          computedSpo2 = (int)(0.80 * computedSpo2 + 0.20 * spo2Val);
        }
      } else if (computedSpo2 == 0) {
        // Initial baseline while settling
        computedSpo2 = 98;
      }
    }

    // Reset cycle min/max for next beat
    irMin = rawIr; irMax = rawIr;
    redMin = rawRed; redMax = rawRed;
  }

  lastIrSignal = irSignal;

  // Signal quality evaluation
  if (!fingerDetected) {
    currentSignalQuality = "NO_FINGER";
  } else if (computedBpm == 0) {
    currentSignalQuality = "CALCULATING";
  } else if (computedSpo2 >= 95) {
    currentSignalQuality = "EXCELLENT";
  } else if (computedSpo2 >= 90) {
    currentSignalQuality = "GOOD";
  } else {
    currentSignalQuality = "FAIR";
  }
}

void processMax30102() {
  if (!max30102Detected) {
    currentSensorStatus = "MAX30102_NOT_FOUND";
    computedBpm = 0;
    computedSpo2 = 0;
    currentSignalQuality = "NO_SIGNAL";
    return;
  }

  // Drain all pending samples from MAX30102 FIFO
  uint8_t available = getAvailableSamples();
  if (available == 0) {
    available = 1;
  }

  while (available > 0) {
    available--;
    uint32_t r = 0, i = 0;
    if (!readMAX30102Sample(r, i)) break;
    processSingleSample(r, i);
  }
}

// ==============================================================================
// 6. AD8232 ECG SAMPLING & PROCESSING
// ==============================================================================
void processEcg() {
  // 1. Check Leads Off detection with debounce
  int loPlus = digitalRead(AD8232_LO_PLUS);
  int loMin  = digitalRead(AD8232_LO_MIN);

  static int leadOffCounter = 0;
  if (loPlus == HIGH || loMin == HIGH) {
    if (leadOffCounter < 5) leadOffCounter++;
  } else {
    if (leadOffCounter > 0) leadOffCounter--;
  }
  ecgLeadOff = (leadOffCounter >= 3);

  if (ecgLeadOff) {
    rawEcgValue = 2048;
    filteredEcg = 2048.0;
    return;
  }

  // 2. Read Analog ECG
  rawEcgValue = analogRead(AD8232_OUT_PIN);

  // 3. Digital Low-Pass / Baseline Wander Filter (EMA)
  ecgBaseline = 0.98 * ecgBaseline + 0.02 * rawEcgValue;
  // Center around 2048 for consistent waveform display
  filteredEcg = (rawEcgValue - ecgBaseline) + 2048.0;

  if (filteredEcg < 0) filteredEcg = 0;
  if (filteredEcg > 4095) filteredEcg = 4095;
}

// ==============================================================================
// 7. WEBSOCKET EVENT HANDLER
// ==============================================================================
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[ESP32-WS] Disconnected from server.");
      break;
    case WStype_CONNECTED:
      Serial.printf("[ESP32-WS] Connected to WebSocket server at %s:%d\n", WS_SERVER_IP, WS_SERVER_PORT);
      break;
    case WStype_TEXT:
      Serial.printf("[ESP32-WS] Received text: %s\n", payload);
      break;
    case WStype_ERROR:
      Serial.println("[ESP32-WS] WebSocket Error occurred.");
      break;
    default:
      break;
  }
}

#if ENABLE_WIFI
WebServer espHttpServer(80);
#endif
char latestTelemetryJson[350] = "{\"heartRate\":0,\"spo2\":0,\"ecg\":2048,\"leadOff\":false,\"signalQuality\":\"NO_FINGER\"}";

void handleHttpData() {
#if ENABLE_WIFI
  espHttpServer.sendHeader("Access-Control-Allow-Origin", "*");
  espHttpServer.send(200, "application/json", latestTelemetryJson);
#endif
}

// ==============================================================================
// 8. DATA TRANSMISSION (USB SERIAL + WI-FI WEBSOCKET)
// ==============================================================================
void transmitSensorPacket() {
  // Construct JSON packet
  StaticJsonDocument<300> doc;
  doc["timestamp"]     = millis();
  doc["heartRate"]     = computedBpm;
  doc["spo2"]          = computedSpo2;
  doc["ecg"]           = (int)filteredEcg;
  doc["leadOff"]       = ecgLeadOff;
  doc["signalQuality"] = currentSignalQuality;
  doc["sensorStatus"]  = currentSensorStatus;
  doc["uptime"]        = millis() / 1000;

  serializeJson(doc, latestTelemetryJson);

  // 1. Send via USB Serial at 115200 baud
  Serial.println(latestTelemetryJson);

  // 2. Send via Wi-Fi WebSocket if connected
  if (wifiConnected && webSocket.isConnected()) {
    webSocket.sendTXT(latestTelemetryJson);
  }
}

// ==============================================================================
// 9. SETUP FUNCTION
// ==============================================================================
void setup() {
  // Initialize USB Serial
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("==================================================");
  Serial.println("   ESP32 CARDIAC HEALTH MONITORING SYSTEM");
  Serial.println("==================================================");

  // Initialize AD8232 ECG GPIOs
  pinMode(AD8232_OUT_PIN, INPUT);
  pinMode(AD8232_LO_PLUS, INPUT);
  pinMode(AD8232_LO_MIN, INPUT);
  analogReadResolution(12); // ESP32 12-bit ADC (0 - 4095)
  Serial.println("[ESP32] AD8232 ECG pins initialized.");

  // Initialize MAX30102 Sensor
  max30102Detected = initMAX30102();
  if (max30102Detected) {
    currentSensorStatus = "CONNECTED";
  } else {
    currentSensorStatus = "MAX30102_ERROR";
  }

  // Initialize Wi-Fi (if enabled)
#if ENABLE_WIFI
  Serial.printf("[ESP32] Connecting to Wi-Fi SSID: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttemptTime = millis();
  // Wait up to 8 seconds for Wi-Fi connection
  while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < 8000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.print("[ESP32] Wi-Fi Connected! IP Address: ");
    Serial.println(WiFi.localIP());

    // Configure WebSocket client
    webSocket.begin(WS_SERVER_IP, WS_SERVER_PORT, WS_SERVER_PATH);
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(3000);

    // Configure direct HTTP telemetry server on port 80
    espHttpServer.on("/data", handleHttpData);
    espHttpServer.on("/", handleHttpData);
    espHttpServer.begin();
    Serial.println("[ESP32] Direct HTTP endpoint live: http://<ESP32_IP>/data");
  } else {
    Serial.println("[ESP32] Wi-Fi connection timeout. Operating in USB Serial mode.");
  }
#endif

  Serial.println("[ESP32] Setup complete. Streaming telemetry started...");
}

// ==============================================================================
// 10. MAIN LOOP (NON-BLOCKING)
// ==============================================================================
void loop() {
  unsigned long currentMicros = micros();
  unsigned long currentMillis = millis();

  // 1. Maintain WebSocket & HTTP services
#if ENABLE_WIFI
  if (wifiConnected) {
    webSocket.loop();
    espHttpServer.handleClient();
  }

  // Periodically check Wi-Fi connection status
  if (currentMillis - lastWifiCheckTime >= 10000) {
    lastWifiCheckTime = currentMillis;
    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
    } else {
      wifiConnected = false;
    }
  }
#endif

  // 2. High-Frequency ECG Sampling (250 Hz -> every 4000 microseconds)
  if (currentMicros - lastEcgSampleTime >= ECG_SAMPLE_INTERVAL_US) {
    lastEcgSampleTime = currentMicros;
    processEcg();
  }

  // 3. Vitals Processing & Telemetry Transmission (10 Hz -> every 100 milliseconds)
  if (currentMillis - lastVitalsProcessTime >= VITALS_INTERVAL_MS) {
    lastVitalsProcessTime = currentMillis;
    processMax30102();
    transmitSensorPacket();
  }
}
