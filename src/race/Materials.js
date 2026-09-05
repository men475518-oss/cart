// 見た目の共通部品: トゥーン（セル）シェーディングのマテリアルと手続きテクスチャ
import * as THREE from 'three';

let _gradient = null;

/** 4 段階のトゥーン用グラデーション（明るい段を多めにしてポップに） */
export function toonGradient() {
  if (_gradient) return _gradient;
  const steps = [96, 168, 224, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _gradient = tex;
  return tex;
}

/** セルシェーディングのマテリアル。MeshLambertMaterial と同じ感覚で使える */
export function toonMat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

const _texCache = new Map();

/** アスファルトのざらつきテクスチャ（頂点カラーに乗算するので明るめに作る） */
export function asphaltTexture(seed = 1) {
  const key = 'asphalt' + seed;
  if (_texCache.has(key)) return _texCache.get(key);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e6e6e6';
  ctx.fillRect(0, 0, size, size);
  let r = seed * 9301 + 49297;
  const rnd = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  for (let i = 0; i < 2600; i++) {
    const v = 200 + Math.floor(rnd() * 70);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _texCache.set(key, tex);
  return tex;
}

/** 芝生・砂などの地面用ノイズ */
export function groundTexture(seed = 2) {
  const key = 'ground' + seed;
  if (_texCache.has(key)) return _texCache.get(key);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ececec';
  ctx.fillRect(0, 0, size, size);
  let r = seed * 7919 + 13;
  const rnd = () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
  for (let i = 0; i < 1400; i++) {
    const v = 210 + Math.floor(rnd() * 45);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 2, 1 + Math.floor(rnd() * 3));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _texCache.set(key, tex);
  return tex;
}

/** サブツリー全体に影の設定を適用 */
export function setShadows(root, cast = true, receive = false) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return root;
}
