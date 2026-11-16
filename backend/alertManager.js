/**
 * AlertManager
 * Evaluates validated sensor data against clinical threshold rules.
 * Manages alert states, severity tiers, debounce persistence, and automatic alarm triggers.
 *
 * NOTE: Prototyping and educational monitoring tool only.
 * Single-lead AD8232 and MAX30102 cannot diagnose or confirm a myocardial infarction (heart attack).
 */

class AlertManager {
  constructor(customThresholds = {}) {
    this.thresholds = Object.assign(
      {
        heartRate: {
          criticalLow: 40,
          warningLow: 50,
          normalLow: 60,
          normalHigh: 100,
          warningHigh: 120,
          criticalHigh: 130,
        },
        spo2: {
          criticalLow: 88,
          warningLow: 93,
          normalLow: 95,
          normalHigh: 100,
        },
      },
      customThresholds
    );

    this.currentAlert = {
      level: 'NORMAL', // 'NORMAL' | 'WARNING' | 'ABNORMAL_RHYTHM' | 'SENSOR_DISCONNECTED' | 'CRITICAL'
      label: 'NORMAL MONITORING',
      isCritical: false,
      reasons: [],
      abnormalValues: {},
      timestamp: Date.now(),
      acknowledged: false,
    };

    // Persistence / Debounce Streaks to eliminate transient false alarms
    this.criticalStreak = 0;
    this.criticalDebounceThreshold = 4; // Require 4 consecutive sustained violations (~1.5s)

    this.history = [];
    this.maxHistory = 100;
  }

  /**
   * Evaluate a processed sensor packet
   * @param {object} packet - Validated packet from SensorProcessor
   * @returns {object} alert evaluation object
   */
  evaluate(packet) {
    if (!packet) {
      this.criticalStreak = 0;
      return this._setAlert({
        level: 'SENSOR_DISCONNECTED',
        label: 'SENSOR DISCONNECTED',
        isCritical: false,
        reasons: ['No sensor data received'],
        abnormalValues: {},
      });
    }

    const reasons = [];
    const abnormalValues = {};
    let isCriticalCandidate = false;
    let isWarningCandidate = false;
    let isAbnormalRhythm = false;

    const noFinger = !packet.hrValid && !packet.spo2Valid;
    const leadsOff = Boolean(packet.leadOff);

    // 1. SENSOR CONNECTION INTEGRITY CHECKS FIRST
    // Disconnected sensors or missing finger must NEVER trigger critical sirens!
    if (noFinger && leadsOff) {
      this.criticalStreak = 0;
      return this._setAlert({
        level: 'SENSOR_DISCONNECTED',
        label: 'ALL SENSORS DISCONNECTED',
        isCritical: false,
        reasons: ['Place finger on MAX30102 and attach ECG leads'],
        abnormalValues: { sensor: 'DISCONNECTED' },
      });
    }

    if (noFinger) {
      this.criticalStreak = 0;
      return this._setAlert({
        level: 'SENSOR_DISCONNECTED',
        label: 'NO FINGER DETECTED',
        isCritical: false,
        reasons: ['Place finger firmly on MAX30102 sensor'],
        abnormalValues: { max30102: 'NO CONTACT' },
      });
    }

    // Suppress clinical alarms while sensor is acquiring / calibrating baseline
    if (packet.signalQuality === 'CALCULATING' || packet.sensorStatus === 'CALIBRATING') {
      this.criticalStreak = 0;
      return this._setAlert({
        level: 'NORMAL',
        label: 'CALCULATING VITALS',
        isCritical: false,
        reasons: ['Acquiring pulse signal... Keep finger steady'],
        abnormalValues: {},
      });
    }

    // 2. CLINICAL THRESHOLD EVALUATION (Only on valid, established signals)
    if (packet.hrValid) {
      const hr = packet.heartRate;
      if (hr < this.thresholds.heartRate.criticalLow) {
        isCriticalCandidate = true;
        reasons.push(`Severe Bradycardia: ${hr} BPM (Threshold < ${this.thresholds.heartRate.criticalLow})`);
        abnormalValues.heartRate = `${hr} BPM`;
      } else if (hr > this.thresholds.heartRate.criticalHigh) {
        isCriticalCandidate = true;
        reasons.push(`Severe Tachycardia: ${hr} BPM (Threshold > ${this.thresholds.heartRate.criticalHigh})`);
        abnormalValues.heartRate = `${hr} BPM`;
      } else if (hr < this.thresholds.heartRate.warningLow) {
        isWarningCandidate = true;
        reasons.push(`Low Heart Rate: ${hr} BPM`);
        abnormalValues.heartRate = `${hr} BPM`;
      } else if (hr > this.thresholds.heartRate.warningHigh) {
        isWarningCandidate = true;
        reasons.push(`Elevated Heart Rate: ${hr} BPM`);
        abnormalValues.heartRate = `${hr} BPM`;
      }
    }

    if (packet.spo2Valid) {
      const spo2 = packet.spo2;
      if (spo2 <= this.thresholds.spo2.criticalLow) {
        isCriticalCandidate = true;
        reasons.push(`Severe Hypoxemia: SpO2 ${spo2}% (Threshold <= ${this.thresholds.spo2.criticalLow}%)`);
        abnormalValues.spo2 = `${spo2}%`;
      } else if (spo2 <= this.thresholds.spo2.warningLow) {
        isWarningCandidate = true;
        reasons.push(`Low Oxygen Saturation: SpO2 ${spo2}%`);
        abnormalValues.spo2 = `${spo2}%`;
      }
    }

    if (packet.rhythmAnalysis === 'IRREGULAR_RHYTHM' || packet.rhythmAnalysis === 'ARRHYTHMIA') {
      isAbnormalRhythm = true;
      reasons.push('Abnormal Cardiac Rhythm Detected');
    }

    // 3. PERSISTENCE FILTER / DEBOUNCE LOGIC
    // Prevents motion artifacts and momentary touch transients from sounding alarms
    if (isCriticalCandidate) {
      this.criticalStreak++;
      if (this.criticalStreak >= this.criticalDebounceThreshold) {
        return this._setAlert({
          level: 'CRITICAL',
          label: 'CRITICAL HEALTH WARNING',
          isCritical: true,
          reasons,
          abnormalValues,
        });
      } else {
        // Verification phase before latching emergency alarm
        return this._setAlert({
          level: 'WARNING',
          label: 'VERIFYING VITALS...',
          isCritical: false,
          reasons: ['Verifying abnormal reading persistence...'],
          abnormalValues,
        });
      }
    } else {
      this.criticalStreak = 0;
    }

    if (isAbnormalRhythm) {
      return this._setAlert({
        level: 'ABNORMAL_RHYTHM',
        label: 'ABNORMAL CARDIAC SIGNAL',
        isCritical: false,
        reasons,
        abnormalValues,
      });
    }

    if (isWarningCandidate) {
      return this._setAlert({
        level: 'WARNING',
        label: 'WARNING',
        isCritical: false,
        reasons,
        abnormalValues,
      });
    }

    if (leadsOff) {
      return this._setAlert({
        level: 'WARNING',
        label: 'ECG LEADS OFF',
        isCritical: false,
        reasons: ['ECG electrodes detached or noisy'],
        abnormalValues: { ecg: 'LEAD OFF' },
      });
    }

    // Default: Normal State
    return this._setAlert({
      level: 'NORMAL',
      label: 'NORMAL MONITORING',
      isCritical: false,
      reasons: ['All vitals within normal parameters'],
      abnormalValues: {},
    });
  }

  _setAlert(newAlert) {
    const previousLevel = this.currentAlert.level;
    const sameCondition =
      previousLevel === newAlert.level &&
      JSON.stringify(this.currentAlert.reasons) === JSON.stringify(newAlert.reasons);

    // If condition cleared from CRITICAL to non-critical, reset acknowledgment
    if (!newAlert.isCritical && this.currentAlert.isCritical) {
      newAlert.acknowledged = false;
    } else if (sameCondition) {
      newAlert.acknowledged = this.currentAlert.acknowledged;
    } else {
      newAlert.acknowledged = false;
    }

    this.currentAlert = {
      ...newAlert,
      timestamp: Date.now(),
    };

    // Keep log in memory
    if (!sameCondition) {
      this.history.unshift({
        level: this.currentAlert.level,
        label: this.currentAlert.label,
        reasons: this.currentAlert.reasons,
        timestamp: this.currentAlert.timestamp,
      });
      if (this.history.length > this.maxHistory) {
        this.history.pop();
      }
    }

    return this.currentAlert;
  }

  acknowledge() {
    this.currentAlert.acknowledged = true;
    return this.currentAlert;
  }

  getStatus() {
    return this.currentAlert;
  }

  getHistory() {
    return this.history;
  }
}

module.exports = AlertManager;
