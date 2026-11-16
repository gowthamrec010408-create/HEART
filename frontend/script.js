/**
 * Frontend Application Controller
 * Real-Time ECG, Heart Rate, and SpO2 Dashboard
 * Audio Alarms, Chart.js Visualizations, Dual Connection Management
 */

// ==============================================================
// 1. STATE & CONSTANTS
// ==============================================================
const BACKEND_PORT = 3000;
// Support direct Node server (port 3000), VS Code Live Server, and direct file:// protocol
const isDirectNode = window.location.protocol.startsWith('http') && window.location.port === String(BACKEND_PORT);
const API_HOST = (window.location.hostname && window.location.hostname.trim() !== '') ? window.location.hostname : 'localhost';
const API_BASE = isDirectNode ? '' : `http://${API_HOST}:${BACKEND_PORT}`;
const WS_HOST = isDirectNode ? window.location.host : `${API_HOST}:${BACKEND_PORT}`;

const STATE = {
  activeMode: 'USB', // 'USB' | 'WIFI'
  isConnected: false,
  usbConnected: false,
  wifiConnected: false,
  esp32Ip: null,
  alarmAcknowledged: false,
  audioContext: null,
  alarmOscillator: null,
  alarmInterval: null,
  audioUnlocked: false,
  lastEcgTime: Date.now(),
  ecgBuffer: [],
  maxEcgPoints: 200,
  hrHistory: [],
  spo2History: [],
  maxTrendPoints: 30,
};

// ==============================================================
// 2. DOM ELEMENT REFERENCES
// ==============================================================
const DOM = {
  body: document.body,
  systemClock: document.getElementById('systemClock'),
  activeModeBadge: document.getElementById('activeModeBadge'),
  monitoringStatusBadge: document.getElementById('monitoringStatusBadge'),

  // Emergency Alarm Elements
  criticalAlarmOverlay: document.getElementById('criticalAlarmOverlay'),
  alarmAbnormalReadings: document.getElementById('alarmAbnormalReadings'),
  alarmReasons: document.getElementById('alarmReasons'),
  alarmTimestamp: document.getElementById('alarmTimestamp'),
  btnAcknowledgeAlarm: document.getElementById('btnAcknowledgeAlarm'),
  audioUnlockPrompt: document.getElementById('audioUnlockPrompt'),
  btnEnableAudio: document.getElementById('btnEnableAudio'),
  btnTestAlarm: document.getElementById('btnTestAlarm'),

  // Mode Selection Tabs
  tabModeUsb: document.getElementById('tabModeUsb'),
  tabModeWifi: document.getElementById('tabModeWifi'),
  usbControls: document.getElementById('usbControls'),
  wifiControls: document.getElementById('wifiControls'),

  // USB Controls
  comPortSelect: document.getElementById('comPortSelect'),
  btnRefreshPorts: document.getElementById('btnRefreshPorts'),
  btnConnectSerial: document.getElementById('btnConnectSerial'),
  btnWebSerial: document.getElementById('btnWebSerial'),
  btnDisconnectSerial: document.getElementById('btnDisconnectSerial'),
  usbStatusDot: document.getElementById('usbStatusDot'),
  usbStatusText: document.getElementById('usbStatusText'),

  // Wi-Fi & IP Controls
  ipAddressInput: document.getElementById('ipAddressInput'),
  ipPortInput: document.getElementById('ipPortInput'),
  btnDetectIp: document.getElementById('btnDetectIp'),
  btnConnectIp: document.getElementById('btnConnectIp'),
  btnDisconnectIp: document.getElementById('btnDisconnectIp'),
  esp32IpDisplay: document.getElementById('esp32IpDisplay'),
  backendWsUrlDisplay: document.getElementById('backendWsUrlDisplay'),
  wifiModeIndicator: document.getElementById('wifiModeIndicator'),
  wifiStatusDot: document.getElementById('wifiStatusDot'),
  wifiStatusText: document.getElementById('wifiStatusText'),

  // Sensor Vitals
  valHeartRate: document.getElementById('valHeartRate'),
  valSpo2: document.getElementById('valSpo2'),
  heartBeatIcon: document.getElementById('heartBeatIcon'),
  hrSignalQuality: document.getElementById('hrSignalQuality'),
  spo2FingerQuality: document.getElementById('spo2FingerQuality'),
  spo2FillBar: document.getElementById('spo2FillBar'),
  max30102StatusBadge: document.getElementById('max30102StatusBadge'),
  spo2StatusBadge: document.getElementById('spo2StatusBadge'),

  // ECG Elements
  leadOffBadge: document.getElementById('leadOffBadge'),
  ecgQualityBadge: document.getElementById('ecgQualityBadge'),
  ecgLeadOffText: document.getElementById('ecgLeadOffText'),
  ecgRawVal: document.getElementById('ecgRawVal'),
  ecgVoltVal: document.getElementById('ecgVoltVal'),
  ecgHealthText: document.getElementById('ecgHealthText'),

  // Canvases
  ecgCanvas: document.getElementById('ecgWaveformChart'),
  hrTrendCanvas: document.getElementById('heartRateChart'),
  spo2TrendCanvas: document.getElementById('spo2Chart'),
};

// ==============================================================
// 3. CHART.JS INITIALIZATION
// ==============================================================
let ecgChart = null;
let hrTrendChart = null;
let spo2TrendChart = null;

function initCharts() {
  // Prepopulate initial buffers
  for (let i = 0; i < STATE.maxEcgPoints; i++) {
    STATE.ecgBuffer.push(2048);
  }
  for (let i = 0; i < STATE.maxTrendPoints; i++) {
    STATE.hrHistory.push(null);
    STATE.spo2History.push(null);
  }

  // 1. ECG Real-Time Waveform Chart
  const ecgCtx = DOM.ecgCanvas.getContext('2d');
  ecgChart = new Chart(ecgCtx, {
    type: 'line',
    data: {
      labels: Array(STATE.maxEcgPoints).fill(''),
      datasets: [
        {
          data: STATE.ecgBuffer,
          borderColor: '#00e676',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.15,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { display: false },
        y: {
          min: 0,
          max: 4095,
          ticks: { display: false },
          grid: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
    },
  });

  // 2. Heart Rate Trend Sparkline
  const hrCtx = DOM.hrTrendCanvas.getContext('2d');
  hrTrendChart = new Chart(hrCtx, {
    type: 'line',
    data: {
      labels: Array(STATE.maxTrendPoints).fill(''),
      datasets: [
        {
          data: STATE.hrHistory,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      scales: {
        x: { display: false },
        y: {
          min: 40,
          max: 160,
          ticks: { color: '#64748b', font: { size: 9 }, stepSize: 30 },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });

  // 3. SpO2 Trend Sparkline
  const spo2Ctx = DOM.spo2TrendCanvas.getContext('2d');
  spo2TrendChart = new Chart(spo2Ctx, {
    type: 'line',
    data: {
      labels: Array(STATE.maxTrendPoints).fill(''),
      datasets: [
        {
          data: STATE.spo2History,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      scales: {
        x: { display: false },
        y: {
          min: 80,
          max: 100,
          ticks: { color: '#64748b', font: { size: 9 }, stepSize: 5 },
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

// ==============================================================
// 4. WEB AUDIO API EMERGENCY SOUND SYSTEM
// ==============================================================
function initAudioContext() {
  if (!STATE.audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    STATE.audioContext = new AudioCtx();
  }
  if (STATE.audioContext.state === 'suspended') {
    STATE.audioContext.resume();
  }
  STATE.audioUnlocked = true;
  DOM.audioUnlockPrompt.classList.add('dismissed');
}

/**
 * Standard Medical High-Priority Pulse Tone
 * Alternates between 880Hz (A5) and 659Hz (E5)
 */
function playEmergencyAlarmBeep() {
  if (!STATE.audioContext || STATE.audioContext.state !== 'running') {
    return;
  }

  try {
    const now = STATE.audioContext.currentTime;
    const osc = STATE.audioContext.createOscillator();
    const gain = STATE.audioContext.createGain();

    osc.type = 'square'; // penetrating medical monitor tone
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(659, now + 0.12);

    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(STATE.audioContext.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  } catch (e) {
    console.error('Audio beep error:', e);
  }
}

function startAlarmSound() {
  if (STATE.alarmInterval) return; // already playing
  playEmergencyAlarmBeep();
  STATE.alarmInterval = setInterval(() => {
    playEmergencyAlarmBeep();
  }, 600);
}

function stopAlarmSound() {
  if (STATE.alarmInterval) {
    clearInterval(STATE.alarmInterval);
    STATE.alarmInterval = null;
  }
}

// ==============================================================
// 5. CRITICAL RED SCREEN EMERGENCY CONTROLLER
// ==============================================================
function triggerCriticalAlarm(alert, readings = {}) {
  DOM.body.classList.add('theme-critical-alarm');
  DOM.criticalAlarmOverlay.classList.remove('hidden');

  // Populate abnormal readings & pathology reasons
  const readingList = [];
  if (readings.heartRate && alert.reasons.some(r => r.toLowerCase().includes('heart') || r.toLowerCase().includes('brady') || r.toLowerCase().includes('tachy'))) {
    readingList.push(`Heart Rate: ${readings.heartRate} BPM`);
  }
  if (readings.spo2 && alert.reasons.some(r => r.toLowerCase().includes('spo2') || r.toLowerCase().includes('oxygen') || r.toLowerCase().includes('hypox'))) {
    readingList.push(`SpO2: ${readings.spo2}%`);
  }
  if (alert.abnormalValues) {
    Object.entries(alert.abnormalValues).forEach(([k, v]) => {
      readingList.push(`${k.toUpperCase()}: ${v}`);
    });
  }

  DOM.alarmAbnormalReadings.textContent = readingList.join(' | ') || 'CRITICAL THRESHOLD VIOLATION';
  DOM.alarmReasons.textContent = alert.reasons.join(' • ') || 'Abnormal cardiac condition detected.';
  DOM.alarmTimestamp.textContent = new Date(alert.timestamp || Date.now()).toLocaleTimeString();

  // If not acknowledged, play sound
  if (!STATE.alarmAcknowledged && !alert.acknowledged) {
    startAlarmSound();
  } else {
    stopAlarmSound();
  }
}

function clearCriticalAlarm() {
  DOM.body.classList.remove('theme-critical-alarm');
  DOM.criticalAlarmOverlay.classList.add('hidden');
  stopAlarmSound();
  STATE.alarmAcknowledged = false;
}

function acknowledgeAlarm() {
  STATE.alarmAcknowledged = true;
  stopAlarmSound();
  DOM.btnAcknowledgeAlarm.textContent = 'ACKNOWLEDGED (MUTED)';
  DOM.btnAcknowledgeAlarm.style.opacity = '0.7';

  // Inform backend
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ACKNOWLEDGE_ALARM' }));
  }
  fetch(`${API_BASE}/api/alarm/acknowledge`, { method: 'POST' }).catch(() => {});
}

// ==============================================================
// 6. DASHBOARD DATA UPDATE HANDLER
// ==============================================================
function updateDashboard(packet) {
  const {
    heartRate,
    hrValid,
    spo2,
    spo2Valid,
    ecg,
    ecgVoltageMv,
    leadOff,
    signalQuality,
    sensorStatus,
    alert,
  } = packet;

  // 1. Update Heart Rate Card
  if (hrValid && heartRate > 0) {
    DOM.valHeartRate.textContent = heartRate;
    DOM.valHeartRate.classList.remove('text-dim');

    // Trigger pulse animation
    DOM.heartBeatIcon.classList.add('beating');
    setTimeout(() => DOM.heartBeatIcon.classList.remove('beating'), 180);

    DOM.hrSignalQuality.textContent = signalQuality || 'GOOD';
    DOM.hrSignalQuality.className = 'stat-val font-bold text-green';

    // Update HR Trend Chart
    STATE.hrHistory.push(heartRate);
    if (STATE.hrHistory.length > STATE.maxTrendPoints) STATE.hrHistory.shift();
    hrTrendChart.data.datasets[0].data = STATE.hrHistory;
    hrTrendChart.update('none');
  } else {
    DOM.valHeartRate.textContent = '--';
    DOM.hrSignalQuality.textContent = signalQuality === 'NO_FINGER' ? 'NO FINGER DETECTED' : 'AWAITING BEAT';
    DOM.hrSignalQuality.className = 'stat-val font-bold text-yellow';
  }

  // MAX30102 Status
  if (sensorStatus === 'MAX30102_ERROR' || sensorStatus === 'MAX30102_NOT_FOUND') {
    DOM.max30102StatusBadge.textContent = 'HARDWARE ERROR';
    DOM.max30102StatusBadge.className = 'mini-badge badge-danger';
  } else if (!hrValid && !spo2Valid) {
    DOM.max30102StatusBadge.textContent = 'NO FINGER';
    DOM.max30102StatusBadge.className = 'mini-badge badge-warning';
  } else {
    DOM.max30102StatusBadge.textContent = 'CONNECTED';
    DOM.max30102StatusBadge.className = 'mini-badge badge-normal';
  }

  // 2. Update SpO2 Card
  if (spo2Valid && spo2 > 0) {
    DOM.valSpo2.textContent = spo2;
    DOM.valSpo2.classList.remove('text-dim');

    // Fill bar
    const fillPercent = Math.min(100, Math.max(0, (spo2 - 80) * 5)); // 80% to 100% scale
    DOM.spo2FillBar.style.width = `${fillPercent}%`;

    DOM.spo2FingerQuality.textContent = 'OPTIMAL CONTACT';
    DOM.spo2FingerQuality.className = 'stat-val font-bold text-green';

    // Update SpO2 Trend Chart
    STATE.spo2History.push(spo2);
    if (STATE.spo2History.length > STATE.maxTrendPoints) STATE.spo2History.shift();
    spo2TrendChart.data.datasets[0].data = STATE.spo2History;
    spo2TrendChart.update('none');
  } else {
    DOM.valSpo2.textContent = '--';
    DOM.spo2FillBar.style.width = '0%';
    DOM.spo2FingerQuality.textContent = 'NO CONTACT';
    DOM.spo2FingerQuality.className = 'stat-val font-bold text-yellow';
  }

  // 3. Update ECG Waveform & Lead-Off
  if (leadOff) {
    DOM.leadOffBadge.textContent = 'LEAD OFF';
    DOM.leadOffBadge.className = 'mini-badge badge-danger';
    DOM.ecgQualityBadge.textContent = 'NO SIGNAL';
    DOM.ecgQualityBadge.className = 'mini-badge badge-danger';
    DOM.ecgLeadOffText.textContent = 'DISCONNECTED (LO+/LO- Active)';
    DOM.ecgLeadOffText.className = 'ecg-stat-value text-red';
    DOM.ecgHealthText.textContent = 'ELECTRODES DETACHED';
    DOM.ecgHealthText.className = 'ecg-stat-value text-red';

    // Push flatline for disconnected ECG
    STATE.ecgBuffer.push(2048);
  } else {
    DOM.leadOffBadge.textContent = 'LEADS ATTACHED';
    DOM.leadOffBadge.className = 'mini-badge badge-normal';
    DOM.ecgQualityBadge.textContent = signalQuality || 'GOOD SIGNAL';
    DOM.ecgQualityBadge.className = 'mini-badge badge-normal';
    DOM.ecgLeadOffText.textContent = 'NORMAL (Leads Attached)';
    DOM.ecgLeadOffText.className = 'ecg-stat-value text-green';
    DOM.ecgHealthText.textContent = 'OPTIMAL';
    DOM.ecgHealthText.className = 'ecg-stat-value text-green';

    // Push real ADC sample
    STATE.ecgBuffer.push(ecg !== undefined ? ecg : 2048);
  }

  if (STATE.ecgBuffer.length > STATE.maxEcgPoints) {
    STATE.ecgBuffer.shift();
  }

  // Render ECG Chart (throttled animation for high FPS)
  ecgChart.data.datasets[0].data = STATE.ecgBuffer;
  ecgChart.update('none');

  DOM.ecgRawVal.textContent = ecg !== undefined ? ecg : 2048;
  DOM.ecgVoltVal.textContent = ecgVoltageMv ? `${(ecgVoltageMv / 1000).toFixed(2)} V` : '1.65 V';

  // 4. Update Alarm Status Banner & Themes
  if (alert) {
    updateAlertStatus(alert, { heartRate, spo2 });
  }
}

function updateAlertStatus(alert, readings = {}) {
  const badge = DOM.monitoringStatusBadge;

  if (alert.level === 'CRITICAL' && alert.isCritical) {
    badge.textContent = 'CRITICAL HEALTH WARNING';
    badge.className = 'status-badge status-critical';
    triggerCriticalAlarm(alert, readings);
  } else {
    clearCriticalAlarm();

    if (alert.level === 'WARNING') {
      badge.textContent = 'WARNING';
      badge.className = 'status-badge status-warning';
    } else if (alert.level === 'ABNORMAL_RHYTHM') {
      badge.textContent = 'ABNORMAL CARDIAC SIGNAL';
      badge.className = 'status-badge status-abnormal';
    } else if (alert.level === 'SENSOR_DISCONNECTED') {
      badge.textContent = 'SENSOR DISCONNECTED';
      badge.className = 'status-badge status-disconnected';
    } else {
      badge.textContent = 'NORMAL MONITORING';
      badge.className = 'status-badge status-normal';
    }
  }
}

// ==============================================================
// 7. WEBSOCKET COMMUNICATION (BACKEND)
// ==============================================================
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${WS_HOST}/ws/dashboard`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[Dashboard] WebSocket connected.');
    STATE.isConnected = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (e) {
      console.error('WS Parse Error:', e);
    }
  };

  ws.onclose = () => {
    console.warn('[Dashboard] WebSocket disconnected. Reconnecting in 3s...');
    STATE.isConnected = false;
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(connectWebSocket, 3000);
    }
  };

  ws.onerror = (err) => {
    console.error('WS Error:', err);
  };
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'SENSOR_DATA':
      updateDashboard(msg.payload);
      break;

    case 'SERIAL_STATUS':
      handleSerialStatus(msg.payload);
      break;

    case 'WIFI_STATUS':
      handleWifiStatus(msg.payload);
      break;

    case 'MODE_CHANGED':
      setUIMode(msg.payload.activeMode);
      break;

    case 'ALARM_ACKNOWLEDGED':
      STATE.alarmAcknowledged = true;
      stopAlarmSound();
      break;

    case 'TEST_ALARM_TRIGGERED':
      updateDashboard(msg.payload);
      break;

    case 'CONNECTION_INIT':
      if (msg.payload.wifiStatus) {
        handleWifiStatus(msg.payload.wifiStatus);
      }
      break;

    default:
      break;
  }
}

// ==============================================================
// 8. CONNECTION & SERIAL MANAGEMENT
// ==============================================================
async function loadSerialPorts() {
  DOM.comPortSelect.innerHTML = '<option value="">Scanning COM ports...</option>';
  try {
    const res = await fetch(`${API_BASE}/api/ports`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    DOM.comPortSelect.innerHTML = '';

    if (!data.ports || data.ports.length === 0) {
      DOM.comPortSelect.innerHTML = '<option value="">No COM ports detected</option>';
      return;
    }

    let defaultSelected = false;
    data.ports.forEach((port) => {
      const opt = document.createElement('option');
      opt.value = port.path;
      const label = port.friendlyName || `${port.path} - ${port.manufacturer || 'Serial Device'}`;
      opt.textContent = label;

      // Auto-prioritize ESP32 CP210x or CH340 or FTDI
      const isEsp32Bridge = (port.manufacturer && (port.manufacturer.toLowerCase().includes('silicon') || port.manufacturer.toLowerCase().includes('wch') || port.manufacturer.toLowerCase().includes('ftdi'))) ||
                            (port.friendlyName && (port.friendlyName.toLowerCase().includes('cp210') || port.friendlyName.toLowerCase().includes('ch340')));

      if (isEsp32Bridge && !defaultSelected) {
        opt.selected = true;
        defaultSelected = true;
      }
      DOM.comPortSelect.appendChild(opt);
    });

    DOM.usbStatusText.textContent = defaultSelected
      ? `Detected ESP32 on ${DOM.comPortSelect.value}. Click "Connect USB".`
      : 'Select port and click "Connect USB".';
    DOM.usbStatusDot.className = 'status-indicator-dot online';
  } catch (err) {
    console.error('loadSerialPorts error:', err);
    DOM.comPortSelect.innerHTML = '<option value="">Backend offline (Run node server.js)</option>';
    DOM.usbStatusText.textContent = 'Backend offline: Please start the server (run "node server.js" or double-click "start.bat"). Retrying...';
    DOM.usbStatusDot.className = 'status-indicator-dot offline';
    // Auto-retry every 3 seconds until backend is reachable
    if (!STATE.portRetryTimer) {
      STATE.portRetryTimer = setTimeout(() => {
        STATE.portRetryTimer = null;
        loadSerialPorts();
      }, 3000);
    }
  }
}

async function connectSerialPort() {
  initAudioContext();
  const selectedPort = DOM.comPortSelect.value;
  if (!selectedPort) {
    if ('serial' in navigator) {
      const useWebSerial = confirm('No COM port selected from backend.\n\nWould you like to connect directly using Web Serial in your browser?');
      if (useWebSerial) {
        return connectWebSerial();
      }
    }
    alert('Please select a COM port first.\n\nIf your ESP32 is not listed, make sure your USB cable is a DATA cable (not charge-only) and click ↻ Refresh.');
    return;
  }

  DOM.btnConnectSerial.disabled = true;
  DOM.btnConnectSerial.textContent = 'Connecting...';

  try {
    const res = await fetch(`${API_BASE}/api/connect-serial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: selectedPort, baudRate: 115200 }),
    });
    const data = await res.json();

    if (data.success) {
      handleSerialStatus({ connected: true, port: selectedPort });
    } else {
      alert(`Connection failed: ${data.error}`);
      handleSerialStatus({ connected: false });
    }
  } catch (err) {
    alert(`Request error: ${err.message}`);
    handleSerialStatus({ connected: false });
  } finally {
    DOM.btnConnectSerial.textContent = 'Connect USB';
  }
}

async function disconnectSerialPort() {
  if (webSerialPort) {
    await disconnectWebSerial();
  }
  try {
    await fetch(`${API_BASE}/api/disconnect-serial`, { method: 'POST' });
    handleSerialStatus({ connected: false });
  } catch (e) {
    console.error(e);
  }
}

// ==============================================================
// 8B. DIRECT WEB SERIAL (BROWSER NATIVE)
// ==============================================================
let webSerialPort = null;
let webSerialReader = null;
let webSerialClosed = false;

async function connectWebSerial() {
  if (!('serial' in navigator)) {
    alert('Web Serial API is not supported in this browser.\nPlease use Google Chrome, Microsoft Edge, Opera, or Brave.');
    return;
  }

  try {
    webSerialPort = await navigator.serial.requestPort();
    await webSerialPort.open({ baudRate: 115200 });
    webSerialClosed = false;
    initAudioContext();

    DOM.usbStatusDot.className = 'status-indicator-dot online';
    DOM.usbStatusText.textContent = 'Web Serial: Connected directly via browser @ 115200 baud!';
    DOM.btnConnectSerial.disabled = true;
    DOM.btnWebSerial.disabled = true;
    DOM.btnDisconnectSerial.disabled = false;
    DOM.activeModeBadge.textContent = 'WEB SERIAL (DIRECT)';
    DOM.activeModeBadge.className = 'mode-badge mode-usb';

    const textDecoder = new TextDecoderStream();
    webSerialPort.readable.pipeTo(textDecoder.writable).catch(() => {});
    const reader = textDecoder.readable.getReader();
    webSerialReader = reader;

    let lineBuffer = '';
    while (!webSerialClosed) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        lineBuffer += value;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const data = JSON.parse(trimmed);
              const isFingerOn = data.heartRate > 0 && data.signalQuality !== 'NO_FINGER';
              updateDashboard({
                ...data,
                hrValid: isFingerOn,
                spo2Valid: isFingerOn,
                ecgVoltageMv: ((data.ecg || 2048) / 4095 * 3300).toFixed(1),
                alert: {
                  level: isFingerOn ? 'NORMAL' : 'SENSOR_DISCONNECTED',
                  label: isFingerOn ? 'NORMAL MONITORING' : 'NO FINGER DETECTED',
                  isCritical: false,
                  reasons: isFingerOn ? ['All vitals within normal parameters'] : ['Place finger on MAX30102 sensor'],
                  abnormalValues: {},
                  timestamp: Date.now(),
                }
              });
            } catch (err) {}
          }
        }
      }
    }
  } catch (err) {
    if (err.name !== 'NotFoundError') {
      alert(`Web Serial Error: ${err.message}`);
    }
    disconnectWebSerial();
  }
}

async function disconnectWebSerial() {
  webSerialClosed = true;
  if (webSerialReader) {
    try {
      await webSerialReader.cancel();
      webSerialReader.releaseLock();
    } catch (e) {}
    webSerialReader = null;
  }
  if (webSerialPort) {
    try {
      await webSerialPort.close();
    } catch (e) {}
    webSerialPort = null;
  }
  DOM.btnConnectSerial.disabled = false;
  DOM.btnWebSerial.disabled = false;
  DOM.btnDisconnectSerial.disabled = true;
  DOM.usbStatusDot.className = 'status-indicator-dot offline';
  DOM.usbStatusText.textContent = 'Serial: Disconnected.';
}

// ==============================================================
// 8C. DIRECT IP CONNECTION (WI-FI / LAN)
// ==============================================================
let ipSocket = null;
let ipPollingInterval = null;

async function detectLocalIp() {
  try {
    const res = await fetch(`${API_BASE}/api/network-info`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.localIps && data.localIps.length > 0) {
      DOM.ipAddressInput.value = data.localIps[0].address;
      DOM.ipPortInput.value = data.port || 3000;
      DOM.backendWsUrlDisplay.textContent = `ws://${data.localIps[0].address}:${data.port || 3000}/ws/dashboard`;
      DOM.wifiStatusText.textContent = `Detected local IP: ${data.localIps[0].address}. Click "Connect via IP".`;
      DOM.wifiStatusDot.className = 'status-indicator-dot online';
    }
  } catch (err) {
    const fallback = window.location.hostname || 'localhost';
    DOM.ipAddressInput.value = fallback;
    DOM.ipPortInput.value = 3000;
    DOM.backendWsUrlDisplay.textContent = `ws://${fallback}:3000/ws/dashboard`;
  }
}

function connectViaIp() {
  initAudioContext();
  const ip = (DOM.ipAddressInput.value || '').trim() || 'localhost';
  const port = (DOM.ipPortInput.value || '').trim() || '3000';

  disconnectViaIp();

  DOM.btnConnectIp.disabled = true;
  DOM.btnConnectIp.textContent = 'Connecting...';
  DOM.wifiStatusDot.className = 'status-indicator-dot';
  DOM.wifiStatusText.textContent = `Connecting to ${ip}:${port}...`;

  const wsUrl = `ws://${ip}:${port}/ws/dashboard`;
  DOM.backendWsUrlDisplay.textContent = wsUrl;

  try {
    ipSocket = new WebSocket(wsUrl);

    ipSocket.onopen = () => {
      DOM.wifiStatusDot.className = 'status-indicator-dot online';
      DOM.wifiStatusText.textContent = `Connected to ${ip}:${port} over Wi-Fi!`;
      DOM.wifiModeIndicator.textContent = 'STREAMING LIVE';
      DOM.btnConnectIp.textContent = 'Connected';
      DOM.btnConnectIp.disabled = true;
      DOM.btnDisconnectIp.disabled = false;
      DOM.esp32IpDisplay.textContent = ip;
      setUIMode('WIFI');
    };

    ipSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('IP WS Parse Error:', e);
      }
    };

    ipSocket.onerror = (err) => {
      console.warn('Dashboard route failed, attempting direct ESP32 HTTP stream...');
      tryDirectEsp32Stream(ip, port);
    };

    ipSocket.onclose = () => {
      if (ipSocket) {
        DOM.wifiStatusDot.className = 'status-indicator-dot offline';
        DOM.wifiStatusText.textContent = `Disconnected from ${ip}:${port}`;
        DOM.wifiModeIndicator.textContent = 'DISCONNECTED';
        DOM.btnConnectIp.textContent = 'Connect via IP';
        DOM.btnConnectIp.disabled = false;
        DOM.btnDisconnectIp.disabled = true;
      }
    };
  } catch (e) {
    tryDirectEsp32Stream(ip, port);
  }
}

function tryDirectEsp32Stream(ip, port) {
  const httpUrl = `http://${ip}:${port === '3000' ? '80' : port}/data`;
  DOM.wifiStatusText.textContent = `Checking direct ESP32 endpoint at ${httpUrl}...`;

  fetch(httpUrl)
    .then(r => r.json())
    .then(data => {
      DOM.wifiStatusDot.className = 'status-indicator-dot online';
      DOM.wifiStatusText.textContent = `Connected directly to ESP32 at ${ip}!`;
      DOM.wifiModeIndicator.textContent = 'DIRECT ESP32 HTTP';
      DOM.btnConnectIp.textContent = 'Connected (Direct)';
      DOM.btnConnectIp.disabled = true;
      DOM.btnDisconnectIp.disabled = false;
      DOM.esp32IpDisplay.textContent = ip;
      setUIMode('WIFI');

      ipPollingInterval = setInterval(() => {
        fetch(httpUrl)
          .then(res => res.json())
          .then(packet => {
            const isFingerOn = packet.heartRate > 0 && packet.signalQuality !== 'NO_FINGER';
            updateDashboard({
              ...packet,
              hrValid: isFingerOn,
              spo2Valid: isFingerOn,
              ecgVoltageMv: ((packet.ecg || 2048) / 4095 * 3300).toFixed(1),
            });
          })
          .catch(() => {});
      }, 100);
    })
    .catch(() => {
      DOM.wifiStatusDot.className = 'status-indicator-dot offline';
      DOM.wifiStatusText.textContent = `Failed to connect to ${ip}:${port}. Check IP address.`;
      DOM.btnConnectIp.textContent = 'Connect via IP';
      DOM.btnConnectIp.disabled = false;
      DOM.btnDisconnectIp.disabled = true;
    });
}

function disconnectViaIp() {
  if (ipPollingInterval) {
    clearInterval(ipPollingInterval);
    ipPollingInterval = null;
  }
  if (ipSocket) {
    const s = ipSocket;
    ipSocket = null;
    s.close();
  }
  DOM.btnConnectIp.textContent = 'Connect via IP';
  DOM.btnConnectIp.disabled = false;
  DOM.btnDisconnectIp.disabled = true;
  DOM.wifiStatusDot.className = 'status-indicator-dot offline';
  DOM.wifiStatusText.textContent = 'Wi-Fi: Disconnected.';
  DOM.wifiModeIndicator.textContent = 'STANDBY';
}

function handleSerialStatus(status) {
  STATE.usbConnected = status.connected;

  if (status.connected) {
    DOM.usbStatusDot.className = 'status-indicator-dot online';
    DOM.usbStatusText.textContent = `USB: Connected to ${status.port} @ 115200 baud.`;
    DOM.btnConnectSerial.disabled = true;
    DOM.btnDisconnectSerial.disabled = false;
  } else {
    DOM.usbStatusDot.className = 'status-indicator-dot offline';
    DOM.usbStatusText.textContent = `USB: Disconnected ${status.reason ? `(${status.reason})` : ''}`;
    DOM.btnConnectSerial.disabled = false;
    DOM.btnDisconnectSerial.disabled = true;
  }
}

function handleWifiStatus(status) {
  STATE.wifiConnected = status.connected;
  STATE.esp32Ip = status.ip;

  if (status.connected && status.ip) {
    DOM.esp32IpDisplay.textContent = status.ip;
    DOM.wifiStatusDot.className = 'status-indicator-dot online';
    DOM.wifiStatusText.textContent = 'Streaming live over Wi-Fi WebSocket';
  } else {
    DOM.esp32IpDisplay.textContent = 'Not Connected';
    DOM.wifiStatusDot.className = 'status-indicator-dot offline';
    DOM.wifiStatusText.textContent = 'Waiting for ESP32 connection...';
  }
}

function setUIMode(mode) {
  STATE.activeMode = mode;

  if (mode === 'USB') {
    DOM.tabModeUsb.classList.add('active');
    DOM.tabModeWifi.classList.remove('active');
    DOM.usbControls.classList.remove('hidden');
    DOM.wifiControls.classList.add('hidden');
    DOM.activeModeBadge.textContent = 'USB SERIAL';
    DOM.activeModeBadge.className = 'mode-badge mode-usb';
  } else {
    DOM.tabModeWifi.classList.add('active');
    DOM.tabModeUsb.classList.remove('active');
    DOM.wifiControls.classList.remove('hidden');
    DOM.usbControls.classList.add('hidden');
    DOM.activeModeBadge.textContent = 'WI-FI MODE';
    DOM.activeModeBadge.className = 'mode-badge mode-wifi';
  }
}

async function switchMode(mode) {
  setUIMode(mode);
  try {
    await fetch(`${API_BASE}/api/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
  } catch (e) {
    console.error(e);
  }
}

// ==============================================================
// 9. EVENT LISTENERS & SETUP
// ==============================================================
function setupEventListeners() {
  // Audio Activation
  DOM.btnEnableAudio.addEventListener('click', () => {
    initAudioContext();
  });

  // Acknowledge Alarm
  DOM.btnAcknowledgeAlarm.addEventListener('click', () => {
    acknowledgeAlarm();
  });

  // Mode Switchers
  DOM.tabModeUsb.addEventListener('click', () => switchMode('USB'));
  DOM.tabModeWifi.addEventListener('click', () => switchMode('WIFI'));

  // Serial Port Buttons
  DOM.btnRefreshPorts.addEventListener('click', loadSerialPorts);
  DOM.btnConnectSerial.addEventListener('click', connectSerialPort);
  if (DOM.btnWebSerial) DOM.btnWebSerial.addEventListener('click', connectWebSerial);
  DOM.btnDisconnectSerial.addEventListener('click', disconnectSerialPort);

  // Wi-Fi & IP Connection Buttons
  if (DOM.btnDetectIp) DOM.btnDetectIp.addEventListener('click', detectLocalIp);
  if (DOM.btnConnectIp) DOM.btnConnectIp.addEventListener('click', connectViaIp);
  if (DOM.btnDisconnectIp) DOM.btnDisconnectIp.addEventListener('click', disconnectViaIp);

  // Test Emergency Alarm Button
  DOM.btnTestAlarm.addEventListener('click', () => {
    initAudioContext();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'TEST_ALARM' }));
    }
  });

  // Clock Update
  setInterval(() => {
    DOM.systemClock.textContent = new Date().toLocaleTimeString();
  }, 1000);
  DOM.systemClock.textContent = new Date().toLocaleTimeString();

  // Load backend network info to show dynamic LAN WebSocket URL
  fetch(`${API_BASE}/api/network-info`)
    .then((r) => r.json())
    .then((info) => {
      if (info.localIps && info.localIps.length > 0) {
        DOM.backendWsUrlDisplay.textContent = `ws://${info.localIps[0].address}:${info.port}/ws/esp32`;
      }
    })
    .catch(() => {});
}

// Initialization on DOM Load
window.addEventListener('DOMContentLoaded', () => {
  initCharts();
  setupEventListeners();
  loadSerialPorts();
  detectLocalIp();
  connectWebSocket();
});

