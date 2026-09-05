// オンライン対戦クライアント（WebSocket）
import { settings } from '../core/Settings.js';

/**
 * 静的ホスティング（GitHub Pages など）で配信されているか。
 * この場合、同じオリジンに対戦サーバーが居ないので接続先を明示してもらう必要がある。
 */
export function isStaticHost() {
  const h = location.hostname;
  return /(\.github\.io|\.gitlab\.io|\.netlify\.app|\.pages\.dev|\.vercel\.app|\.web\.app|\.firebaseapp\.com|\.surge\.sh)$/.test(h);
}

/** ビルド時に組み込まれた対戦サーバー（.env.production の VITE_SERVER_URL） */
export const BUILT_IN_SERVER_URL = ((import.meta.env && import.meta.env.VITE_SERVER_URL) || '').trim();

function normalizeUrl(u) {
  if (/^wss?:\/\//.test(u)) return u;
  if (/^https?:\/\//.test(u)) return u.replace(/^http/, 'ws');
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + u;
}

/** サーバーアドレスが決まっているか（組み込み or 手入力 or 同一オリジンにサーバーがある） */
export function hasServerConfigured() {
  return !!(settings.get('serverUrl') || '').trim() || !!BUILT_IN_SERVER_URL || !isStaticHost();
}

export function defaultServerUrl() {
  const custom = (settings.get('serverUrl') || '').trim();
  if (custom) return normalizeUrl(custom);
  if (BUILT_IN_SERVER_URL) return normalizeUrl(BUILT_IN_SERVER_URL);
  if (import.meta.env && import.meta.env.DEV) return `ws://${location.hostname}:8787`;
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
}

export class NetClient {
  constructor() {
    this.ws = null;
    this.id = null;
    this.room = null;
    this.handlers = new Map();
    this.connected = false;
    this.latency = 0;
    this.serverOffset = 0;
    this._pingTimer = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this.handlers.get(type)?.delete(fn);
  }
  emit(type, data) {
    const hs = this.handlers.get(type);
    if (hs) for (const h of [...hs]) {
      try {
        h(data);
      } catch (e) {
        console.error('net handler error', type, e);
      }
    }
  }

  connect(url = defaultServerUrl(), name = '') {
    return new Promise((resolve, reject) => {
      if (this.ws) this.close();
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      const timeout = setTimeout(() => {
        if (!this.connected) {
          reject(new Error('接続がタイムアウトしました'));
          ws.close();
        }
      }, 8000);
      ws.onopen = () => {
        this.send({ t: 'hello', name });
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        if (msg.t === 'welcome') {
          this.id = msg.id;
          this.connected = true;
          clearTimeout(timeout);
          this._pingTimer = setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 5000);
          this.send({ t: 'ping', ts: Date.now() });
          resolve(msg);
        } else if (msg.t === 'pong') {
          const rtt = Date.now() - msg.ts;
          this.latency = rtt;
          this.serverOffset = msg.now - (Date.now() - rtt / 2);
        } else if (msg.t === 'room') {
          this.room = msg.room;
          this.emit('room', msg);
        } else this.emit(msg.t, msg);
      };
      ws.onerror = () => {
        if (!this.connected) {
          clearTimeout(timeout);
          reject(new Error('サーバーに接続できません'));
        }
        this.emit('error', { msg: 'connection error' });
      };
      ws.onclose = () => {
        const was = this.connected;
        this.connected = false;
        clearInterval(this._pingTimer);
        if (was) this.emit('disconnected', {});
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  createRoom(profile, opts = {}) {
    this.send({ t: 'create', ...profile, ...opts });
  }
  joinRoom(code, profile) {
    this.send({ t: 'join', code: String(code).toUpperCase().trim(), ...profile });
  }
  joinCasual(profile) {
    this.send({ t: 'casual', ...profile });
  }
  spectate(code) {
    this.send({ t: 'spectate', code: String(code).toUpperCase().trim() });
  }
  leave() {
    this.send({ t: 'leave' });
    this.room = null;
  }
  setReady(ready) {
    this.send({ t: 'ready', ready: !!ready });
  }
  updateProfile(profile) {
    this.send({ t: 'update', ...profile });
  }
  setCourse(course, laps) {
    this.send({ t: 'setCourse', course, laps });
  }
  startRace(opts) {
    this.send({ t: 'start', ...opts });
  }
  sendState(kartId, s) {
    this.send({ t: 'state', id: kartId, s });
  }
  sendEvent(e) {
    this.send({ t: 'event', e });
  }
  chat(msg) {
    this.send({ t: 'chat', msg });
  }
  close() {
    clearInterval(this._pingTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        /* ignore */
      }
    }
    this.ws = null;
    this.connected = false;
    this.room = null;
  }
}
