/**
 * WebSocketManager
 * Manages WebSocket communication for:
 * 1. Web dashboard client(s) (`/ws/dashboard` or `/`)
 * 2. ESP32 Wi-Fi client (`/ws/esp32`)
 *
 * Supports bi-directional messaging, heartbeat, client tracking, and broadcasting.
 */

const { WebSocketServer, WebSocket } = require('ws');

class WebSocketManager {
  constructor(server, options = {}) {
    this.server = server;
    this.options = options;

    // Separate client pools
    this.dashboardClients = new Set();
    this.esp32Client = null;
    this.esp32Ip = null;
    this.isEsp32Connected = false;

    // Callbacks
    this.onEsp32Data = options.onEsp32Data || (() => {});
    this.onEsp32StatusChange = options.onEsp32StatusChange || (() => {});
    this.onDashboardMessage = options.onDashboardMessage || (() => {});

    this.wss = new WebSocketServer({ server });
    this._init();
  }

  _init() {
    this.wss.on('connection', (ws, req) => {
      const url = req.url || '';
      const remoteIp = req.socket.remoteAddress;

      // Identify client type by path or headers
      if (url.includes('/ws/esp32') || url.includes('/esp32')) {
        this._handleEsp32Connection(ws, req);
      } else {
        this._handleDashboardConnection(ws, req);
      }
    });

    // Heartbeat ping interval
    this.pingInterval = setInterval(() => {
      this.dashboardClients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });

      if (this.esp32Client) {
        if (this.esp32Client.isAlive === false) {
          console.warn('[WebSocketManager] ESP32 ping timeout, terminating socket.');
          this.esp32Client.terminate();
        } else {
          this.esp32Client.isAlive = false;
          this.esp32Client.ping();
        }
      }
    }, 15000);

    this.wss.on('close', () => {
      clearInterval(this.pingInterval);
    });
  }

  _handleDashboardConnection(ws, req) {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    this.dashboardClients.add(ws);
    console.log(`[WebSocketManager] Dashboard client connected. Total clients: ${this.dashboardClients.size}`);

    // Send initial status payload to newly connected dashboard
    ws.send(
      JSON.stringify({
        type: 'CONNECTION_INIT',
        payload: {
          wifiStatus: {
            connected: this.isEsp32Connected,
            esp32Ip: this.esp32Ip,
          },
        },
      })
    );

    ws.on('message', (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        this.onDashboardMessage(parsed, ws);
      } catch (err) {
        console.error('[WebSocketManager] Error parsing message from dashboard:', err.message);
      }
    });

    ws.on('close', () => {
      this.dashboardClients.delete(ws);
      console.log(`[WebSocketManager] Dashboard client disconnected. Total: ${this.dashboardClients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[WebSocketManager] Dashboard WS error:', err.message);
      this.dashboardClients.delete(ws);
    });
  }

  _handleEsp32Connection(ws, req) {
    // If another ESP32 was connected, close the previous one
    if (this.esp32Client && this.esp32Client !== ws) {
      try {
        this.esp32Client.close(1000, 'Replaced by new ESP32 connection');
      } catch (e) {}
    }

    this.esp32Client = ws;
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Clean IP address (handles ::ffff:192.168.x.x)
    let ip = req.socket.remoteAddress || 'Unknown';
    if (ip.startsWith('::ffff:')) {
      ip = ip.replace('::ffff:', '');
    }
    this.esp32Ip = ip;
    this.isEsp32Connected = true;

    console.log(`[WebSocketManager] ESP32 Wi-Fi connected from IP: ${this.esp32Ip}`);

    this.onEsp32StatusChange({
      connected: true,
      ip: this.esp32Ip,
      timestamp: Date.now(),
    });

    // Broadcast Wi-Fi connection update to dashboard
    this.broadcastToDashboard({
      type: 'WIFI_STATUS',
      payload: {
        connected: true,
        ip: this.esp32Ip,
      },
    });

    ws.on('message', (data) => {
      ws.isAlive = true;
      const strData = data.toString();
      this.onEsp32Data(strData, 'WIFI');
    });

    ws.on('close', () => {
      console.log(`[WebSocketManager] ESP32 disconnected from IP: ${this.esp32Ip}`);
      this.isEsp32Connected = false;
      const disconnectedIp = this.esp32Ip;
      this.esp32Client = null;

      this.onEsp32StatusChange({
        connected: false,
        ip: disconnectedIp,
        timestamp: Date.now(),
      });

      this.broadcastToDashboard({
        type: 'WIFI_STATUS',
        payload: {
          connected: false,
          ip: null,
          reason: 'ESP32 disconnected from Wi-Fi WebSocket',
        },
      });
    });

    ws.on('error', (err) => {
      console.error('[WebSocketManager] ESP32 WS error:', err.message);
    });
  }

  /**
   * Broadcast payload to all connected dashboard web clients
   * @param {object} payload
   */
  broadcastToDashboard(payload) {
    const data = JSON.stringify(payload);
    for (const client of this.dashboardClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Send control command to ESP32 (if connected)
   * @param {object} commandObj
   */
  sendToEsp32(commandObj) {
    if (this.esp32Client && this.esp32Client.readyState === WebSocket.OPEN) {
      this.esp32Client.send(JSON.stringify(commandObj));
      return true;
    }
    return false;
  }

  getEsp32Status() {
    return {
      connected: this.isEsp32Connected,
      ip: this.esp32Ip,
    };
  }

  close() {
    clearInterval(this.pingInterval);
    this.wss.close();
  }
}

module.exports = WebSocketManager;

