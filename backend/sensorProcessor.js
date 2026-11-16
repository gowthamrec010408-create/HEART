/**
 * SensorProcessor
 * Validates, normalizes, and filters incoming sensor packets from Serial or Wi-Fi.
 */

class SensorProcessor {
  constructor(options = {}) {
    this.options = Object.assign(
      {
        minHeartRate: 30,
        maxHeartRate: 240,
        minSpo2: 50,
        maxSpo2: 100,
        adcMax: 4095, // ESP32 12-bit ADC
      },
      options
    );

    // Rolling statistics buffer
    this.history = {
      heartRate: [],
      spo2: [],
      ecg: [],
      maxHistoryLength: 50,
    };

    this.lastValidPacket = null;
    this.totalPacketsReceived = 0;
    this.corruptPackets = 0;
  }

  /**
   * Process raw input (string or parsed object)
   * @param {string|object} rawInput
   * @returns {object|null} validated processed packet or null if corrupted
   */
  process(rawInput) {
    let data = rawInput;

    if (typeof rawInput === 'string') {
      const trimmed = rawInput.trim();
      if (!trimmed || !trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        return null;
      }
      try {
        data = JSON.parse(trimmed);
      } catch (err) {
        this.corruptPackets++;
        return null;
      }
    }

    if (!data || typeof data !== 'object') {
      this.corruptPackets++;
      return null;
    }

    this.totalPacketsReceived++;

    // Extract fields with robust fallback
    const timestamp = Number.isFinite(data.timestamp) ? data.timestamp : Date.now();
    const leadOff = Boolean(data.leadOff);
    
    // Parse ECG
    let ecgRaw = Number(data.ecg);
    if (!Number.isFinite(ecgRaw)) {
      ecgRaw = 2048; // mid-range fallback
    }
    // Constrain to ESP32 12-bit ADC (0 - 4095)
    ecgRaw = Math.max(0, Math.min(this.options.adcMax, ecgRaw));

    // Convert raw ADC (0-4095, 3.3V) to estimated millivolts
    const ecgVoltageMv = Number(((ecgRaw / this.options.adcMax) * 3300).toFixed(1));

    // Determine finger contact state from raw packet
    const isFingerRemoved =
      data.fingerDetected === false ||
      data.sensorStatus === 'FINGER_REMOVED' ||
      data.signalQuality === 'NO_FINGER';

    // Parse Heart Rate
    let heartRate = Number(data.heartRate);
    let hrValid = true;
    if (isFingerRemoved || !Number.isFinite(heartRate) || heartRate <= 0) {
      heartRate = 0;
      hrValid = false;
    } else {
      heartRate = Math.round(heartRate);
      if (heartRate < this.options.minHeartRate || heartRate > this.options.maxHeartRate) {
        hrValid = false;
      }
    }

    // Parse SpO2
    let spo2 = Number(data.spo2);
    let spo2Valid = true;
    if (isFingerRemoved || !Number.isFinite(spo2) || spo2 <= 0) {
      spo2 = 0;
      spo2Valid = false;
    } else {
      spo2 = Math.round(spo2);
      if (spo2 < this.options.minSpo2 || spo2 > this.options.maxSpo2) {
        spo2Valid = false;
      }
    }

    // Determine signal quality and sensor status
    let signalQuality = data.signalQuality || 'UNKNOWN';
    let sensorStatus = data.sensorStatus || 'CONNECTED';

    if (isFingerRemoved || (!hrValid && !spo2Valid)) {
      signalQuality = 'NO_FINGER';
      sensorStatus = 'FINGER_NOT_DETECTED';
    } else if (leadOff) {
      signalQuality = 'LEADS_OFF';
      sensorStatus = 'AD8232_LEAD_OFF';
    } else if (signalQuality === 'CALCULATING') {
      sensorStatus = 'CALIBRATING';
    } else if (signalQuality === 'UNKNOWN') {
      if (spo2 >= 95 && heartRate >= 55 && heartRate <= 100) {
        signalQuality = 'EXCELLENT';
      } else if (spo2 >= 90) {
        signalQuality = 'GOOD';
      } else {
        signalQuality = 'FAIR';
      }
    }

    // Update rolling history
    if (hrValid) {
      this.history.heartRate.push(heartRate);
      if (this.history.heartRate.length > this.history.maxHistoryLength) {
        this.history.heartRate.shift();
      }
    }

    if (spo2Valid) {
      this.history.spo2.push(spo2);
      if (this.history.spo2.length > this.history.maxHistoryLength) {
        this.history.spo2.shift();
      }
    }

    this.history.ecg.push(ecgRaw);
    if (this.history.ecg.length > this.history.maxHistoryLength) {
      this.history.ecg.shift();
    }

    const processedPacket = {
      timestamp,
      heartRate,
      hrValid,
      spo2,
      spo2Valid,
      ecg: ecgRaw,
      ecgVoltageMv,
      leadOff,
      signalQuality,
      sensorStatus,
      connectionMode: data.connectionMode || 'UNKNOWN',
      deviceUptime: data.uptime || null,
      stats: {
        avgHeartRate: this._calculateAverage(this.history.heartRate),
        avgSpo2: this._calculateAverage(this.history.spo2),
      },
    };

    this.lastValidPacket = processedPacket;
    return processedPacket;
  }

  _calculateAverage(array) {
    if (!array || array.length === 0) return null;
    const sum = array.reduce((acc, val) => acc + val, 0);
    return Math.round(sum / array.length);
  }

  reset() {
    this.history.heartRate = [];
    this.history.spo2 = [];
    this.history.ecg = [];
    this.lastValidPacket = null;
  }
}

module.exports = SensorProcessor;

