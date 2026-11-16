/**
 * Main Application Server
 * IoT-Based Cardiac Health Monitoring and Early Warning System
 * ESP32 + MAX30102 + AD8232
 */

const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const cors = require('cors');

const SerialManager = require('./backend/serial');
const WebSocketManager = require('./backend/websocket');
const SensorProcessor = require('./backend/sensorProcessor');
const AlertManager = require('./backend/alertManager');

// Load optional custom config or use defaults
let config = {};
try {
  config = require('./config/config.json');
} catch (e) {
  try {
    config = require('./config/config.example.json');
  } catch (err) {
    config = {};
  }
}

const PORT = process.env.PORT || config.server?.port || 3000;
const HOST = config.server?.host || '0.0.0.0';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Core Instances
const processor = new SensorProcessor();
const alertMgr = new AlertManager(config.thresholds);

// Current Active Communication Mode: 'USB' | 'WIFI' | 'NONE'
let activeMode = 'USB';

// Helper: Get local IPv4 addresses (to help user configure ESP32 Wi-Fi)
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // IPv4 and non-internal
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({ interface: name, address: net.address });
      }
    }
  }
  return addresses;
}

// -------------------------------------------------------------
// SENSOR DATA PIPELINE
// -------------------------------------------------------------
function handleIncomingSensorData(rawData, sourceMode) {
  // Enforce single active mode: ignore data from the inactive channel
  if (activeMode !== sourceMode) {
    return;
  }

  const processed = processor.process(rawData);
  if (!processed) {
    return; // Ignore malformed or incomplete packet
  }

  // Tag with current connection mode
  processed.connectionMode = activeMode;

  // Evaluate clinical rules and generate alert status
  const alert = alertMgr.evaluate(processed);

  // Broadcast to all dashboard clients
  wsManager.broadcastToDashboard({
    type: 'SENSOR_DATA',
    payload: {
      ...processed,
      alert,
      systemMode: activeMode,
    },
  });
}

// -------------------------------------------------------------
// SERIAL MANAGER INITIALIZATION
// -------------------------------------------------------------
const serialManager = new SerialManager({
  baudRate: config.serial?.baudRate || 115200,
  onData: (line) => {
    handleIncomingSensorData(line, 'USB');
  },
  onStatusChange: (status) => {
    console.log('[Server] Serial status changed:', status);
    wsManager.broadcastToDashboard({
      type: 'SERIAL_STATUS',
      payload: status,
    });
  },
  onError: (err) => {
    console.error('[Server] Serial Error:', err.message);
    wsManager.broadcastToDashboard({
      type: 'NOTIFICATION',
      payload: {
        type: 'error',
        message: `USB Serial Error: ${err.message}`,
      },
    });
  },
});

// -------------------------------------------------------------
// WEBSOCKET MANAGER INITIALIZATION
// -------------------------------------------------------------
const wsManager = new WebSocketManager(server, {
  onEsp32Data: (data) => {
    handleIncomingSensorData(data, 'WIFI');
  },
  onEsp32StatusChange: (status) => {
    console.log('[Server] ESP32 Wi-Fi status changed:', status);
    wsManager.broadcastToDashboard({
      type: 'WIFI_STATUS',
      payload: status,
    });
  },
  onDashboardMessage: (msg, ws) => {
    if (msg.type === 'ACKNOWLEDGE_ALARM') {
      const updated = alertMgr.acknowledge();
      wsManager.broadcastToDashboard({
        type: 'ALARM_ACKNOWLEDGED',
        payload: updated,
      });
    } else if (msg.type === 'SET_MODE') {
      if (['USB', 'WIFI'].includes(msg.mode)) {
        activeMode = msg.mode;
        console.log(`[Server] Active mode set to: ${activeMode}`);
        wsManager.broadcastToDashboard({
          type: 'MODE_CHANGED',
          payload: { activeMode },
        });
      }
    } else if (msg.type === 'TEST_ALARM') {
      // Simulate test critical alarm for emergency drill verification
      const testAlert = {
        level: 'CRITICAL',
        label: 'CRITICAL HEALTH WARNING',
        isCritical: true,
        reasons: ['EMERGENCY DRILL / TEST ALARM TRIGGERED'],
        abnormalValues: { heartRate: '155 BPM', spo2: '86%' },
        timestamp: Date.now(),
        acknowledged: false,
      };
      wsManager.broadcastToDashboard({
        type: 'TEST_ALARM_TRIGGERED',
        payload: {
          heartRate: 155,
          hrValid: true,
          spo2: 86,
          spo2Valid: true,
          ecg: 3100,
          leadOff: false,
          signalQuality: 'GOOD',
          sensorStatus: 'CONNECTED',
          alert: testAlert,
          systemMode: activeMode,
        },
      });
    }
  },
});

// -------------------------------------------------------------
// REST API ROUTES
// -------------------------------------------------------------

// 1. List Available Serial Ports
app.get('/api/ports', async (req, res) => {
  try {
    const ports = await serialManager.listPorts();
    res.json({ success: true, ports });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Connect to Serial Port
app.post('/api/connect-serial', async (req, res) => {
  const { port, baudRate } = req.body;
  if (!port) {
    return res.status(400).json({ success: false, error: 'Port path is required' });
  }

  try {
    await serialManager.connect(port, baudRate || 115200);
    activeMode = 'USB';
    wsManager.broadcastToDashboard({
      type: 'MODE_CHANGED',
      payload: { activeMode: 'USB' },
    });
    res.json({
      success: true,
      message: `Connected to ${port}`,
      status: serialManager.getStatus(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Disconnect Serial Port
app.post('/api/disconnect-serial', (req, res) => {
  try {
    serialManager.disconnect();
    res.json({ success: true, message: 'Serial port disconnected' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Switch Active Mode (USB vs WIFI)
app.post('/api/mode', (req, res) => {
  const { mode } = req.body;
  if (!['USB', 'WIFI'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'Mode must be USB or WIFI' });
  }

  activeMode = mode;
  wsManager.broadcastToDashboard({
    type: 'MODE_CHANGED',
    payload: { activeMode },
  });

  res.json({ success: true, activeMode });
});

// 5. System Status Summary
app.get('/api/status', (req, res) => {
  res.json({
    activeMode,
    serial: serialManager.getStatus(),
    wifi: wsManager.getEsp32Status(),
    alert: alertMgr.getStatus(),
    localIps: getLocalIpAddresses(),
    serverPort: PORT,
  });
});

// 6. Acknowledge Alarm
app.post('/api/alarm/acknowledge', (req, res) => {
  const updated = alertMgr.acknowledge();
  wsManager.broadcastToDashboard({
    type: 'ALARM_ACKNOWLEDGED',
    payload: updated,
  });
  res.json({ success: true, alert: updated });
});

// 7. Get Host Network IPs for easy ESP32 configuration
app.get('/api/network-info', (req, res) => {
  res.json({
    localIps: getLocalIpAddresses(),
    port: PORT,
    wsEsp32UrlExample: `ws://${getLocalIpAddresses()[0]?.address || '192.168.1.xxx'}:${PORT}/ws/esp32`,
  });
});

// Catch-all route to serve the dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// -------------------------------------------------------------
// START SERVER
// -------------------------------------------------------------
server.listen(PORT, HOST, () => {
  const localIps = getLocalIpAddresses();
  console.log('================================================================');
  console.log('   IoT Cardiac Health Monitoring & Early Warning System');
  console.log(`   Server running at: http://localhost:${PORT}`);
  if (localIps.length > 0) {
    console.log('   LAN Access IPs:');
    localIps.forEach((ip) => {
      console.log(`     - http://${ip.address}:${PORT} (${ip.interface})`);
      console.log(`       ESP32 WebSocket URL: ws://${ip.address}:${PORT}/ws/esp32`);
    });
  }
  console.log('================================================================');
});

