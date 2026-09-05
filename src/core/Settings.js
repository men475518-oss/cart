// 設定の永続化（localStorage）
const KEY = 'mofukart.settings.v1';

const DEFAULTS = {
  playerName: '',
  bgmVolume: 0.6,
  sfxVolume: 0.9,
  voice: true,        // キャラクターボイス（音声合成）
  steerSensitivity: 1.0, // タッチのハンドルの効き（大きいほど少ない指の動きで曲がる）
  gyro: false,        // ジャイロ操作
  gyroSensitivity: 1.0,
  autoAccel: false,   // 自動アクセル（片手プレイ向け）
  quality: 'auto',    // auto | low | high
  cpuLevel: 'normal', // easy | normal | hard
  laps: 3,
  faceToFace: true,   // 2人画面分割のとき上画面を反転（向かい合わせ）
  controlLayout: 'right', // アクセルボタンの位置 right | left
  serverUrl: '',
  lastCharacter: 'taro',
  lastCourse: 'meadow',
  lastKart: { color: 'default', wheels: 'standard', accessory: 'none' },
  hapticFeedback: true,
};

class SettingsStore {
  constructor() {
    this.data = { ...DEFAULTS };
    this.load();
  }
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) {
      /* ignore */
    }
  }
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch (e) {
      /* ignore */
    }
  }
  get(k) {
    return this.data[k];
  }
  set(k, v) {
    this.data[k] = v;
    this.save();
  }
  reset() {
    this.data = { ...DEFAULTS };
    this.save();
  }
}

export const settings = new SettingsStore();
export { DEFAULTS as SETTINGS_DEFAULTS };
