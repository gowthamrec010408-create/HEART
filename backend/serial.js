/**
 * SerialPort Manager for ESP32 USB Communication
 * Connects to ESP32 over USB Serial at 115200 baud, reads newline-delimited JSON,
 * detects disconnections, and handles port enumeration.
 */

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

class SerialManager {
  constructor(options = {}) {
    this.baudRate = options.baudRate || 115200;
    this.currentPort = null;
    this.parser = null;
    this.isConnected = false;
    this.activePortName = null;

    // Callbacks
    this.onData = options.onData || (() => {});
    this.onError = options.onError || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
  }

  /**
   * List available COM ports
   * @returns {Promise<Array<{path: string, manufacturer: string, friendlyName: string}>>}
   */
  async listPorts() {
    try {
      const ports = await SerialPort.list();
      return ports.map((port) => ({
        path: port.path,
        manufacturer: port.manufacturer || 'Unknown',
        serialNumber: port.serialNumber || '',
        pnpId: port.pnpId || '',
        friendlyName: port.friendlyName || `${port.path} (${port.manufacturer || 'Serial Device'})`,
      }));
    } catch (err) {
      console.error('[SerialManager] Error listing ports:', err.message);
      return [];
    }
  }

  /**
   * Connect to specified COM port
   * @param {string} portName (e.g. "COM3" or "/dev/ttyUSB0")
   * @param {number} baudRate
   * @returns {Promise<boolean>}
   */
  connect(portName, baudRate = this.baudRate) {
    return new Promise((resolve, reject) => {
      if (this.isConnected) {
        if (this.activePortName === portName) {
          return resolve(true); // already connected to this port
        }
        this.disconnect();
      }

      this.activePortName = portName;
      this.baudRate = baudRate;

      try {
        this.currentPort = new SerialPort({
          path: portName,
          baudRate: this.baudRate,
          autoOpen: false,
          hupcl: false,
        });

        this.parser = this.currentPort.pipe(
          new ReadlineParser({ delimiter: '\n', includeDelimiter: false })
        );

        this.currentPort.open((err) => {
          if (err) {
            console.error(`[SerialManager] Failed to open ${portName}:`, err.message);
            this.isConnected = false;
            this.activePortName = null;
            this.onStatusChange({ connected: false, error: err.message, port: portName });
            return reject(err);
          }

          this.isConnected = true;
          console.log(`[SerialManager] Connected to ${portName} at ${this.baudRate} baud`);
          this.onStatusChange({ connected: true, port: portName, baudRate: this.baudRate });

          // Listen for data lines
          this.parser.on('data', (line) => {
            if (this.onData && typeof this.onData === 'function') {
              this.onData(line.trim(), 'USB');
            }
          });

          // Port error handling
          this.currentPort.on('error', (portErr) => {
            console.error(`[SerialManager] Port error on ${portName}:`, portErr.message);
            this.onError(portErr);
            this._handleDisconnect(portErr.message);
          });

          // Unplug / close handling
          this.currentPort.on('close', () => {
            console.log(`[SerialManager] Port ${portName} closed`);
            this._handleDisconnect('Port closed');
          });

          resolve(true);
        });
      } catch (err) {
        this._handleDisconnect(err.message);
        reject(err);
      }
    });
  }

  /**
   * Disconnect the active serial port
   */
  disconnect() {
    if (this.currentPort && this.currentPort.isOpen) {
      try {
        this.currentPort.close((err) => {
          if (err) console.error('[SerialManager] Error while closing port:', err.message);
        });
      } catch (e) {
        console.error('[SerialManager] Exception closing port:', e.message);
      }
    }
    this._handleDisconnect('User disconnected');
  }

  _handleDisconnect(reason = 'Disconnected') {
    const wasConnected = this.isConnected;
    const closedPort = this.activePortName;
    this.isConnected = false;
    this.activePortName = null;
    this.currentPort = null;
    this.parser = null;

    if (wasConnected) {
      this.onStatusChange({
        connected: false,
        port: closedPort,
        reason,
      });
    }
  }

  getStatus() {
    return {
      connected: this.isConnected,
      port: this.activePortName,
      baudRate: this.baudRate,
    };
  }
}

module.exports = SerialManager;

