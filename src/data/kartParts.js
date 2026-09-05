// カートのカスタマイズパーツ
export const KART_COLORS = [
  { id: 'default', name: 'キャラ標準', hex: null },
  { id: 'red', name: 'レッド', hex: 0xff4d4d },
  { id: 'blue', name: 'ブルー', hex: 0x3a86ff },
  { id: 'green', name: 'グリーン', hex: 0x4caf50 },
  { id: 'yellow', name: 'イエロー', hex: 0xffd23f },
  { id: 'pink', name: 'ピンク', hex: 0xff8fb1 },
  { id: 'purple', name: 'パープル', hex: 0x9b5de5 },
  { id: 'white', name: 'ホワイト', hex: 0xf7f7f7 },
  { id: 'black', name: 'ブラック', hex: 0x2b2b2b },
];

// wheels: 物理パラメータへの補正値（乗算）
export const KART_WHEELS = [
  { id: 'standard', name: 'スタンダード', desc: 'クセのない標準タイヤ', mod: { accel: 1, speed: 1, handling: 1, offroad: 1 }, radius: 0.42, width: 0.32, color: 0x333333 },
  { id: 'offroad', name: 'オフロード', desc: 'コース外でも速いが最高速ダウン', mod: { accel: 1, speed: 0.95, handling: 0.95, offroad: 1.4 }, radius: 0.5, width: 0.4, color: 0x3d3d3d },
  { id: 'slick', name: 'スリック', desc: '最高速アップ、コース外に弱い', mod: { accel: 0.95, speed: 1.06, handling: 1, offroad: 0.7 }, radius: 0.4, width: 0.4, color: 0x222222 },
  { id: 'roller', name: 'ローラー', desc: '加速とハンドリングが良く、最高速は低め', mod: { accel: 1.15, speed: 0.93, handling: 1.1, offroad: 1 }, radius: 0.3, width: 0.28, color: 0x4a4a6a },
];

export const KART_ACCESSORIES = [
  { id: 'none', name: 'なし' },
  { id: 'flag', name: 'はた' },
  { id: 'antenna', name: 'アンテナボール' },
  { id: 'spoiler', name: 'スポイラー' },
  { id: 'roof', name: 'パラソル' },
];

export const DEFAULT_KART = { color: 'default', wheels: 'standard', accessory: 'none' };
