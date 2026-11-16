# IoT-Based Cardiac Health Monitoring and Early Warning System
### ESP32 • MAX30102 • AD8232 • Node.js • WebSocket • Chart.js

An end-to-end medical IoT system designed for real-time cardiac health monitoring, abnormal condition detection, and early warning alerts. The system monitors continuous Electrocardiogram (ECG) waveforms, photoplethysmography (PPG) Heart Rate (BPM), and Blood Oxygen Saturation (SpO2) using an ESP32 microcontroller, transmitting live telemetry via either **USB Wired Serial** or **Wi-Fi WebSockets** to a responsive, web-based hospital/clinical style monitoring dashboard.

---

## 1. REQUIRED HARDWARE

| Component | Description | Qty |
| :--- | :--- | :--- |
| **ESP32 DevKit V1** | 30-pin or 36-pin Dual-Core Microcontroller with 2.4 GHz Wi-Fi & Bluetooth | 1 |
| **MAX30102** | High-Sensitivity Optical Pulse Oximeter & Heart-Rate Sensor Module (I2C) | 1 |
| **AD8232** | Single-Lead Heart Rate Monitor Analog Front-End (ECG Sensor) | 1 |
| **Biomedical Electrodes** | Standard 3-lead ECG electrode pads (Right Arm, Left Arm, Right Leg) | 3 |
| **Micro-USB to USB-A Cable** | Data & power cable for programming and USB serial communication | 1 |
| **Jumper Wires** | Female-to-Female / Male-to-Female Dupont wires | 10+ |
| **Breadboard** | Optional prototyping breadboard | 1 |

---

## 2. SENSOR WIRING & PINOUT

### 2.1 MAX30102 Pinout to ESP32 (I2C Communication)
> **Note:** The MAX30102 sensor requires 3.3V logic. Verify if your breakout board has an onboard voltage regulator or pull-up resistors to 3.3V.

| MAX30102 Pin | ESP32 GPIO Pin | Function |
| :--- | :--- | :--- |
| **VIN / VCC** | **3.3V** | Power (3.3V) |
| **GND** | **GND** | Ground |
| **SDA** | **GPIO 21** | I2C Data |
| **SCL** | **GPIO 22** | I2C Clock |

### 2.2 AD8232 Pinout to ESP32 (Analog ECG & Lead-Off Detection)

| AD8232 Pin | ESP32 GPIO Pin | Function |
| :--- | :--- | :--- |
| **3.3V** | **3.3V** | Power (3.3V) |
| **GND** | **GND** | Ground |
| **OUTPUT** | **GPIO 34** | ADC1 Channel 6 (Analog ECG Waveform Input) |
| **LO+** | **GPIO 26** | Lead-Off Detection Positive (Digital Input) |
| **LO-** | **GPIO 27** | Lead-Off Detection Negative (Digital Input) |
| **SDN** | *Unconnected* | Shutdown pin (leave floating or pulled to 3.3V) |

### 2.3 AD8232 Electrode Placement (Einthoven's Triangle Lead I)
* **RA (Right Arm / Red):** Right side of chest below the right clavicle.
* **LA (Left Arm / Yellow):** Left side of chest below the left clavicle.
* **RL (Right Leg / Green):** Lower right abdomen or right hip (Reference/Ground electrode).

---

## 3. ARDUINO IDE SETUP

1. **Download & Install Arduino IDE:**
   Download the latest version from [arduino.cc](https://www.arduino.cc/en/software).
2. **Add ESP32 Board Support:**
   - Open Arduino IDE $\rightarrow$ **File** $\rightarrow$ **Preferences**.
   - In the **Additional Board Manager URLs** field, paste:
     ```text
     https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
     ```
   - Go to **Tools** $\rightarrow$ **Board** $\rightarrow$ **Boards Manager...**
   - Search for **esp32** by Espressif Systems and click **Install**.
3. **Select Your Board:**
   - Go to **Tools** $\rightarrow$ **Board** $\rightarrow$ **ESP32 Arduino** $\rightarrow$ **ESP32 Dev Module** (or your specific ESP32 board).
   - Set **Upload Speed:** `921600` (or `115200` if upload fails).
   - Set **CPU Frequency:** `240MHz (WiFi/BT)`.

---

## 4. REQUIRED ESP32 LIBRARIES

Install the following libraries using the Arduino Library Manager (**Sketch** $\rightarrow$ **Include Library** $\rightarrow$ **Manage Libraries...**):

1. **WebSockets by Markus Sattler** (Version 2.4.0 or higher)
   * *Search:* `WebSockets`
   * *Author:* Markus Sattler
2. **ArduinoJson by Benoit Blanchon** (Version 6.x or 7.x)
   * *Search:* `ArduinoJson`
   * *Author:* Benoit Blanchon
3. **Wire & WiFi:**
   * Built-in as standard libraries in the official ESP32 Arduino Core package.

---

## 5. ESP32 FIRMWARE CONFIGURATION & UPLOAD

1. Open the sketch in Arduino IDE:
   ```text
   esp32_firmware/heart_monitor.ino
   ```
2. **Configure Wi-Fi Credentials & Host IP:**
   Locate lines 45–53 in `heart_monitor.ino`:
   ```cpp
   const char* WIFI_SSID     = "YOUR_WIFI_SSID";       // Your 2.4GHz Wi-Fi Name
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";   // Your Wi-Fi Password
   const char* WS_SERVER_IP  = "192.168.1.100";        // Your Computer's Local LAN IP
   const int   WS_SERVER_PORT = 3000;
   ```
   *(If you are exclusively using USB Serial mode, you do not need to configure Wi-Fi, as the firmware always transmits over USB Serial simultaneously).*
3. **Connect ESP32 via USB cable** to your computer.
4. Select the COM port under **Tools** $\rightarrow$ **Port** (e.g., `COM3`, `COM4`, or `/dev/ttyUSB0`).
5. Click **Upload** ($\rightarrow$).
   *(If the upload hangs on `Connecting........_____.....`, press and hold the **BOOT** button on the ESP32 until the flashing progress percentage begins).*

---

## 6. NODE.JS INSTALLATION

1. Download and install **Node.js LTS (v18.x, v20.x, or v22+)** from [nodejs.org](https://nodejs.org/).
2. Verify installation in your terminal:
   ```bash
   node -v
   npm -v
   ```

---

## 7. PROJECT DEPENDENCY INSTALLATION

Navigate to the project root directory and run:

```bash
npm install
```

This installs:
* `express` — Web server serving the dashboard
* `ws` — High-performance WebSocket engine for dashboard and ESP32 streaming
* `serialport` & `@serialport/parser-readline` — USB serial communication engine
* `cors` — Cross-origin resource sharing support

---

## 8. STARTING THE BACKEND SERVER

Start the backend server using:

```bash
npm start
```
*Or during development with auto-reload:*
```bash
npm run dev
```

Output:
```text
================================================================
   IoT Cardiac Health Monitoring & Early Warning System
   Server running at: http://localhost:3000
   LAN Access IPs:
     - http://192.168.1.105:3000 (Wi-Fi)
       ESP32 WebSocket URL: ws://192.168.1.105:3000/ws/esp32
================================================================
```

---

## 9. DASHBOARD ACCESS

1. Open your web browser (Chrome, Edge, Firefox, or Safari).
2. Visit:
   ```text
   http://localhost:3000
   ```
3. To view from another laptop, tablet, or smartphone on the same Wi-Fi network, navigate to the LAN IP shown in your console (e.g., `http://192.168.1.105:3000`).
4. **Enable Alarm Audio:** Click the **ENABLE ALARM AUDIO** prompt at the top of the browser to allow Web Audio API alert sound playback.

---

## 10. DUAL CONNECTION OPERATING PROCEDURES

### 10.1 Mode 1: USB Wired Serial Connection
1. Connect your ESP32 to your computer using a Micro-USB cable.
2. In the dashboard's **Connection Settings** section, ensure **USB SERIAL MODE** is selected.
3. Click **↻ Refresh** to scan for connected COM ports.
4. Select your ESP32 COM port from the dropdown (e.g., `COM3`, `COM4`, `/dev/ttyUSB0`).
5. Click **Connect USB**.
6. The status indicator will turn **GREEN** and live telemetry will immediately begin streaming into the Heart Rate, SpO2, and ECG cards.
7. To safely disconnect, click **Disconnect**. If the USB cable is unplugged, the system automatically detects the disconnection and updates the dashboard status.

### 10.2 Mode 2: Wi-Fi Wireless WebSocket Connection
1. Ensure both your computer and the ESP32 are connected to the same Wi-Fi network (2.4 GHz).
2. Note your computer's local LAN IP (displayed in the backend terminal or on the Wi-Fi settings tab).
3. Ensure this IP is configured in `heart_monitor.ino` as `WS_SERVER_IP`.
4. Flash the ESP32 and power it from any USB wall charger, power bank, or laptop.
5. In the dashboard, switch to **WI-FI MODE**.
6. Once the ESP32 connects to Wi-Fi, it establishes a WebSocket client stream to `ws://<YOUR_IP>:3000/ws/esp32`.
7. The dashboard displays the ESP32's assigned IP address and updates all readings wirelessly without refreshing the page.

---

## 11. CARDIAC EARLY WARNING & AUTOMATIC RED SCREEN ALERT

The monitoring system runs a clinical rule-based engine:

### 11.1 Alert Classification Tiers
* **NORMAL MONITORING (Green):**
  * Heart Rate: 60 – 100 BPM
  * SpO2: 95% – 100%
  * ECG Leads: Attached & Signal Quality Optimal
* **WARNING (Yellow):**
  * Heart Rate: 50 – 59 BPM (Mild Bradycardia) or 101 – 120 BPM (Elevated)
  * SpO2: 91% – 94% (Mild Hypoxia)
  * ECG: Poor signal quality or motion artifacts detected
* **ABNORMAL CARDIAC SIGNAL (Orange):**
  * Irregular R-R intervals or arrhythmia indicators
* **SENSOR DISCONNECTED (Blue-Gray):**
  * AD8232 Lead-Off (LO+ or LO- active)
  * MAX30102 finger removed
  * **Crucial Safety Rule:** Lead disconnection or finger absence **NEVER** triggers a false critical emergency alarm.
* **CRITICAL HEALTH WARNING (Red Screen Alert):**
  * Severe Bradycardia: Heart Rate < 40 BPM
  * Severe Tachycardia: Heart Rate > 130 BPM
  * Critical Hypoxemia: SpO2 $\le$ 90%

### 11.2 Automatic Red Screen Emergency Protocol
When a verified critical abnormality is detected:
1. The **entire dashboard background switches to a flashing Red alarm theme**.
2. A **large emergency warning banner** appears at the top.
3. The specific abnormal vitals and diagnostic reason are prominently displayed.
4. A **repeating medical emergency warning sound** plays via the JavaScript Web Audio API.
5. The user can silence and acknowledge the alarm by clicking **ACKNOWLEDGE ALARM**.
6. When vitals return to normal thresholds, the normal theme is automatically restored and the alarm halts.
7. You can test this protocol at any time using the **⚡ Test Emergency Alarm** button.

---

## 12. PROJECT ARCHITECTURE

```text
heart-monitoring-system/
│
├── server.js                        # Express & WebSocket server, mode coordinator, API routes
├── package.json                     # Node.js project manifest & dependencies
├── README.md                        # Complete project technical documentation
│
├── frontend/
│   ├── index.html                   # Medical monitoring interface & alarm overlay
│   ├── style.css                    # Professional dark navy medical theme & animations
│   └── script.js                    # Web Audio API alarms, Chart.js ECG, WS client
│
├── esp32_firmware/
│   └── heart_monitor.ino            # ESP32 C++ firmware (I2C MAX30102 driver, 250Hz AD8232 ADC)
│
├── backend/
│   ├── serial.js                    # SerialPort COM port manager & auto-disconnect handler
│   ├── websocket.js                 # Multi-client WebSocket server (Dashboard + ESP32)
│   ├── sensorProcessor.js           # Packet validation, sanitization, and rolling stats
│   └── alertManager.js              # Multi-parameter clinical threshold rules engine
│
└── config/
    └── config.example.json          # Configurable thresholds, ports, and audio settings
```

---

## 13. TROUBLESHOOTING

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **"No COM ports detected"** | Missing USB-to-UART bridge driver | Install the CP2102 or CH340 driver for your ESP32 board from Silicon Labs or WCH. |
| **Upload Error: `Timed out waiting for packet header`** | ESP32 bootloader not in download mode | Hold down the **BOOT** button on the ESP32 while uploading begins. |
| **MAX30102 Part ID Check Fails** | Incorrect wiring or missing pullups | Verify SDA $\rightarrow$ GPIO 21 and SCL $\rightarrow$ GPIO 22. Ensure 3.3V is supplied. |
| **ECG displays flatline or 2048** | AD8232 leads off or electrode dry | Ensure electrode pads are firmly adhered to skin and lead wires are snapped on securely. |
| **Wi-Fi connection fails** | 5 GHz network or wrong IP | ESP32 only supports 2.4 GHz Wi-Fi. Verify your computer's local IP using `ipconfig` (Windows) or `ifconfig` (Mac/Linux). |
| **No alarm sound playing** | Browser audio autoplay blocked | Click the **ENABLE ALARM AUDIO** button at the top banner or interact anywhere on the page. |

---

## 14. MEDICAL DISCLAIMER

> **IMPORTANT:** This project is an engineering prototype developed for research, laboratory experiments, and educational demonstrations. The MAX30102 optical sensor and AD8232 single-lead ECG monitor are not certified medical devices under FDA or CE regulations. They **must not** be used for clinical diagnosis, life-critical patient monitoring, or confirming myocardial infarction (heart attack).

#   H E A R T  
 