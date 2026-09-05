// カート＆キャラクターの 3D モデル（プリミティブの組み合わせで生成）
import * as THREE from 'three';
import { KART_COLORS, KART_WHEELS } from '../data/kartParts.js';

const _tmpColor = new THREE.Color();

function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}
function sphere(r, color, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4)), mat(color));
  m.position.set(x, y, z);
  return m;
}
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}
function cone(r, h, color, x = 0, y = 0, z = 0, seg = 10) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color));
  m.position.set(x, y, z);
  return m;
}
function cylinder(rt, rb, h, color, x = 0, y = 0, z = 0, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.set(x, y, z);
  return m;
}

// ---------- 目・口（共通） ----------
function addFace(head, eyeColor, r, opts = {}) {
  const ex = opts.eyeSpacing ?? 0.17;
  const ey = opts.eyeY ?? 0.08;
  const es = opts.eyeSize ?? 0.085;
  const z = r * 0.86;
  for (const s of [-1, 1]) {
    const white = sphere(es * 1.35, 0xffffff, s * ex, ey, z, 10);
    white.scale.z = 0.5;
    head.add(white);
    const pupil = sphere(es, eyeColor, s * ex, ey, z + es * 0.6, 8);
    pupil.scale.z = 0.5;
    head.add(pupil);
    const hl = sphere(es * 0.35, 0xffffff, s * ex + es * 0.35, ey + es * 0.35, z + es * 1.0, 6);
    head.add(hl);
    // ほっぺ
    const cheek = sphere(es * 0.9, opts.cheek ?? 0xffb3c6, s * (ex + 0.13), ey - 0.14, z - 0.05, 8);
    cheek.scale.z = 0.3;
    cheek.material.transparent = true;
    cheek.material.opacity = 0.7;
    head.add(cheek);
  }
  if (!opts.noMouth) {
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 6, 10, Math.PI), mat(0x442222));
    mouth.position.set(0, ey - 0.16, z + 0.02);
    mouth.rotation.z = Math.PI;
    head.add(mouth);
  }
}

// ---------- キャラクター（種族別） ----------
const CHAR_BUILDERS = {
  pyon(c) {
    const g = new THREE.Group();
    const body = sphere(0.3, c.body, 0, 0.5, 0);
    body.scale.set(1, 1.1, 0.9);
    g.add(body);
    const head = sphere(0.42, c.body, 0, 1.05, 0.05);
    addFace(head, c.eye, 0.42, { eyeSpacing: 0.16 });
    // 長い耳
    for (const s of [-1, 1]) {
      const ear = cylinder(0.09, 0.11, 0.7, c.body, s * 0.18, 0.62, -0.05);
      ear.rotation.z = -s * 0.25;
      const inner = cylinder(0.05, 0.06, 0.55, c.accent, 0, 0.02, 0.05);
      ear.add(inner);
      const tip = sphere(0.1, c.body, 0, 0.35, 0);
      ear.add(tip);
      head.add(ear);
    }
    // 鼻
    head.add(sphere(0.05, c.accent, 0, 0.0, 0.41, 6));
    g.add(head);
    g.add(sphere(0.12, 0xffffff, 0, 0.45, -0.3, 8)); // しっぽ
    return g;
  },
  moco(c) {
    const g = new THREE.Group();
    const wool = sphere(0.4, c.body, 0, 0.55, 0);
    g.add(wool);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      g.add(sphere(0.17, c.body, Math.cos(a) * 0.35, 0.55 + Math.sin(a * 2) * 0.12, Math.sin(a) * 0.3, 8));
    }
    const head = sphere(0.36, c.accent, 0, 1.05, 0.15);
    addFace(head, c.eye, 0.36, { eyeSpacing: 0.15 });
    // もこもこの前髪
    for (let i = 0; i < 5; i++) head.add(sphere(0.15, c.body, (i - 2) * 0.12, 0.3, 0.05 - Math.abs(i - 2) * 0.03, 8));
    for (const s of [-1, 1]) {
      const ear = sphere(0.1, c.accent, s * 0.36, 0.05, -0.05, 8);
      ear.scale.set(1.4, 0.6, 0.8);
      head.add(ear);
    }
    g.add(head);
    return g;
  },
  taro(c) {
    const g = new THREE.Group();
    const body = sphere(0.3, c.body, 0, 0.5, 0);
    body.scale.set(1, 1.05, 0.9);
    g.add(body);
    g.add(sphere(0.2, c.accent, 0, 0.42, 0.18, 8)); // 胸の白
    const head = sphere(0.42, c.body, 0, 1.05, 0.05);
    addFace(head, c.eye, 0.42, { eyeSpacing: 0.17, noMouth: true });
    const snout = sphere(0.2, c.accent, 0, -0.05, 0.36, 10);
    snout.scale.set(1.2, 0.8, 0.8);
    head.add(snout);
    head.add(sphere(0.07, 0x222222, 0, 0.0, 0.53, 6)); // 鼻
    for (const s of [-1, 1]) {
      const ear = cone(0.12, 0.3, c.body, s * 0.26, 0.4, -0.05, 6);
      ear.rotation.z = -s * 0.3;
      head.add(ear);
    }
    g.add(head);
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.05, 6, 10, Math.PI * 1.3), mat(c.body));
    tail.position.set(0, 0.55, -0.32);
    tail.rotation.y = Math.PI / 2;
    g.add(tail);
    return g;
  },
  mint(c) {
    const g = new THREE.Group();
    const body = sphere(0.28, c.body, 0, 0.5, 0);
    body.scale.set(1, 1.1, 0.9);
    g.add(body);
    const head = sphere(0.4, c.body, 0, 1.05, 0.05);
    addFace(head, c.eye, 0.4, { eyeSpacing: 0.16, eyeSize: 0.095, noMouth: true });
    head.add(sphere(0.045, 0xff8fb1, 0, -0.03, 0.4, 6)); // 鼻
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 8, Math.PI), mat(0x442222));
    mouth.position.set(0, -0.09, 0.39);
    mouth.rotation.z = Math.PI;
    head.add(mouth);
    for (const s of [-1, 1]) {
      const ear = cone(0.13, 0.32, c.body, s * 0.24, 0.42, -0.02, 4);
      ear.rotation.z = -s * 0.35;
      const inner = cone(0.07, 0.2, 0xffb3c6, 0, -0.02, 0.05, 4);
      ear.add(inner);
      head.add(ear);
      // ヒゲ
      for (let k = 0; k < 2; k++) {
        const w = box(0.35, 0.012, 0.012, 0xffffff, s * 0.35, -0.05 + k * 0.06 - 0.03, 0.3);
        w.rotation.y = s * 0.3;
        w.rotation.z = (k - 0.5) * 0.25 * s;
        head.add(w);
      }
    }
    g.add(head);
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 12, Math.PI * 1.2), mat(c.body));
    tail.position.set(0.1, 0.5, -0.3);
    tail.rotation.y = Math.PI / 2;
    g.add(tail);
    return g;
  },
  pepe(c) {
    const g = new THREE.Group();
    const body = sphere(0.34, c.body, 0, 0.55, 0);
    body.scale.set(1, 1.2, 0.95);
    g.add(body);
    const belly = sphere(0.26, c.accent, 0, 0.5, 0.12, 10);
    belly.scale.set(1, 1.15, 0.7);
    g.add(belly);
    const head = sphere(0.38, c.body, 0, 1.08, 0.05);
    const face = sphere(0.3, c.accent, 0, 0.0, 0.12, 10);
    face.scale.set(1.05, 0.95, 0.75);
    head.add(face);
    addFace(head, c.eye, 0.38, { eyeSpacing: 0.15, noMouth: true, cheek: 0xffb3c6 });
    const beak = cone(0.1, 0.24, 0xffb703, 0, -0.03, 0.42, 6);
    beak.rotation.x = Math.PI / 2;
    head.add(beak);
    g.add(head);
    for (const s of [-1, 1]) {
      const flipper = box(0.12, 0.42, 0.22, c.body, s * 0.38, 0.55, 0.05);
      flipper.rotation.z = -s * 0.5;
      g.add(flipper);
    }
    // 黄色い羽飾り
    for (const s of [-1, 1]) {
      const tuft = cone(0.05, 0.22, 0xffd166, s * 0.2, 0.36, -0.05, 5);
      tuft.rotation.z = -s * 0.7;
      head.add(tuft);
    }
    return g;
  },
  don(c) {
    const g = new THREE.Group();
    const body = sphere(0.38, c.body, 0, 0.5, 0);
    body.scale.set(1.15, 1.05, 0.95);
    g.add(body);
    g.add(sphere(0.24, c.accent, 0, 0.45, 0.22, 8));
    const head = sphere(0.46, c.body, 0, 1.12, 0.05);
    addFace(head, c.eye, 0.46, { eyeSpacing: 0.17, eyeSize: 0.075, noMouth: true });
    const muzzle = sphere(0.2, c.accent, 0, -0.1, 0.38, 10);
    muzzle.scale.set(1.3, 0.9, 0.8);
    head.add(muzzle);
    head.add(sphere(0.08, 0x1a1a1a, 0, -0.04, 0.55, 6));
    for (const s of [-1, 1]) {
      const ear = sphere(0.14, c.body, s * 0.36, 0.36, -0.05, 8);
      ear.add(sphere(0.07, c.accent, 0, 0, 0.08, 6));
      head.add(ear);
    }
    g.add(head);
    for (const s of [-1, 1]) g.add(sphere(0.14, c.body, s * 0.42, 0.6, 0.15, 8));
    return g;
  },
  hino(c) {
    const g = new THREE.Group();
    const body = sphere(0.32, c.body, 0, 0.5, 0);
    body.scale.set(1, 1.1, 0.9);
    g.add(body);
    g.add(sphere(0.22, c.accent, 0, 0.45, 0.18, 8));
    const head = sphere(0.42, c.body, 0, 1.05, 0.05);
    addFace(head, 0x2b2b2b, 0.42, { eyeSpacing: 0.17, eyeSize: 0.09, noMouth: true, cheek: 0xffd166 });
    const snout = sphere(0.18, c.body, 0, -0.08, 0.36, 8);
    snout.scale.set(1.2, 0.7, 0.9);
    head.add(snout);
    for (const s of [-1, 1]) {
      head.add(sphere(0.035, 0x331111, s * 0.07, -0.05, 0.52, 5));
      const horn = cone(0.07, 0.3, 0xffd166, s * 0.22, 0.42, -0.05, 6);
      horn.rotation.z = -s * 0.5;
      head.add(horn);
      // 翼
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 3), mat(0xc0392b));
      wing.position.set(s * 0.42, 0.7, -0.15);
      wing.rotation.z = s * 1.3;
      wing.rotation.y = s * 0.3;
      wing.scale.z = 0.2;
      g.add(wing);
    }
    // 背中のトゲ
    for (let k = 0; k < 3; k++) head.add(cone(0.06, 0.16, 0xffd166, 0, 0.4 - k * 0.02, -0.1 - k * 0.14, 4));
    g.add(head);
    const tail = cone(0.08, 0.6, c.body, 0, 0.5, -0.5, 6);
    tail.rotation.x = -Math.PI / 2 + 0.4;
    g.add(tail);
    tail.add(cone(0.1, 0.16, 0xffd166, 0, 0.35, 0, 4));
    return g;
  },
  hoo(c) {
    const g = new THREE.Group();
    const body = sphere(0.34, c.body, 0, 0.55, 0);
    body.scale.set(1, 1.15, 0.95);
    g.add(body);
    const chest = sphere(0.26, c.accent, 0, 0.5, 0.14, 10);
    chest.scale.set(1, 1.1, 0.6);
    g.add(chest);
    const head = sphere(0.42, c.body, 0, 1.1, 0.05);
    // 大きな目まわり
    for (const s of [-1, 1]) {
      const disc = sphere(0.19, c.accent, s * 0.18, 0.05, 0.3, 10);
      disc.scale.z = 0.5;
      head.add(disc);
    }
    addFace(head, 0x2b2b2b, 0.42, { eyeSpacing: 0.18, eyeSize: 0.11, eyeY: 0.05, noMouth: true, cheek: 0xffd7b5 });
    const beak = cone(0.07, 0.18, 0xffb703, 0, -0.1, 0.42, 5);
    beak.rotation.x = Math.PI / 2;
    head.add(beak);
    for (const s of [-1, 1]) {
      const tuft = cone(0.08, 0.28, c.body, s * 0.28, 0.4, -0.05, 5);
      tuft.rotation.z = -s * 0.5;
      head.add(tuft);
      const wing = sphere(0.14, c.body, s * 0.36, 0.55, -0.05, 8);
      wing.scale.set(0.6, 1.5, 0.9);
      g.add(wing);
    }
    g.add(head);
    return g;
  },
};

// ---------- カートボディ（キャラクター固有デザイン） ----------
function buildKartBody(style, color, accent) {
  const g = new THREE.Group();
  const chassis = box(1.5, 0.22, 2.5, 0x333333, 0, 0.42, 0);
  g.add(chassis);
  switch (style) {
    case 'carrot': {
      const body = cone(0.55, 2.4, color, 0, 0.75, 0.2, 10);
      body.rotation.x = Math.PI / 2;
      body.scale.set(1.3, 1, 0.9);
      g.add(body);
      for (let k = 0; k < 3; k++) {
        const leaf = cone(0.14, 0.7, accent, (k - 1) * 0.22, 1.1, -1.1, 5);
        leaf.rotation.x = -0.5;
        leaf.rotation.z = (k - 1) * 0.3;
        g.add(leaf);
      }
      break;
    }
    case 'cloud': {
      const base = sphere(0.7, color, 0, 0.75, 0.1, 12);
      base.scale.set(1.2, 0.75, 1.4);
      g.add(base);
      for (const [x, y, z, r] of [[-0.6, 0.85, 0.5, 0.42], [0.6, 0.85, 0.5, 0.42], [-0.55, 0.9, -0.5, 0.4], [0.55, 0.9, -0.5, 0.4], [0, 0.95, 1.0, 0.45], [0, 0.9, -1.0, 0.4]]) {
        g.add(sphere(r, accent, x, y, z, 10));
      }
      break;
    }
    case 'bone': {
      const shaft = cylinder(0.42, 0.42, 1.8, color, 0, 0.78, 0, 12);
      shaft.rotation.x = Math.PI / 2;
      g.add(shaft);
      for (const z of [-1.0, 1.0]) for (const x of [-0.35, 0.35]) g.add(sphere(0.4, accent, x, 0.78, z, 10));
      break;
    }
    case 'fish': {
      const body = sphere(0.7, color, 0, 0.8, 0.1, 14);
      body.scale.set(1.0, 0.8, 1.7);
      g.add(body);
      const tail = cone(0.5, 0.8, accent, 0, 0.85, -1.5, 3);
      tail.rotation.x = -Math.PI / 2;
      tail.scale.z = 0.25;
      g.add(tail);
      const fin = cone(0.25, 0.5, accent, 0, 1.4, 0.2, 3);
      fin.scale.z = 0.25;
      g.add(fin);
      for (const s of [-1, 1]) g.add(sphere(0.1, 0xffffff, s * 0.5, 0.95, 0.95, 8));
      break;
    }
    case 'ice': {
      const body = box(1.4, 0.7, 2.3, color, 0, 0.85, 0);
      g.add(body);
      for (const [x, z, h] of [[-0.4, 0.6, 0.6], [0.45, 0.3, 0.9], [0.1, -0.6, 0.7], [-0.5, -0.4, 0.5]]) {
        const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat(accent, { transparent: true, opacity: 0.85 }));
        crystal.position.set(x, 1.2 + h * 0.4, z);
        crystal.scale.y = h * 1.6;
        g.add(crystal);
      }
      break;
    }
    case 'log': {
      const log = cylinder(0.62, 0.62, 2.5, color, 0, 0.85, 0, 12);
      log.rotation.x = Math.PI / 2;
      g.add(log);
      for (const z of [-1.26, 1.26]) {
        const ring = cylinder(0.55, 0.55, 0.05, 0xe8c48a, 0, 0.85, z, 12);
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
      }
      g.add(sphere(0.2, accent, 0.4, 1.4, 0.8, 8));
      g.add(sphere(0.16, accent, -0.35, 1.35, -0.6, 8));
      break;
    }
    case 'flame': {
      const body = box(1.4, 0.7, 2.3, color, 0, 0.85, 0);
      g.add(body);
      for (let k = 0; k < 5; k++) {
        const f = cone(0.15, 0.6 + (k % 2) * 0.3, accent, (k - 2) * 0.28, 1.35, -1.0, 4);
        f.rotation.x = -0.6;
        g.add(f);
      }
      g.add(cone(0.18, 0.5, accent, 0, 1.45, 0.6, 4));
      break;
    }
    case 'moon': {
      const body = box(1.4, 0.65, 2.3, color, 0, 0.82, 0);
      g.add(body);
      const moon = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.14, 8, 14, Math.PI * 1.2), mat(accent));
      moon.position.set(0, 1.5, -0.9);
      moon.rotation.z = Math.PI * 0.4;
      g.add(moon);
      for (const [x, z] of [[-0.5, 0.8], [0.5, 0.9], [0, 0.3]]) g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), mat(accent)).translateX(x).translateY(1.25).translateZ(z));
      break;
    }
    default: {
      g.add(box(1.4, 0.7, 2.3, color, 0, 0.85, 0));
    }
  }
  // ハンドル
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 12), mat(0x222222));
  wheel.position.set(0, 1.25, 0.55);
  wheel.rotation.x = 0.6;
  g.add(wheel);
  return g;
}

export function buildAccessory(id, accent) {
  const g = new THREE.Group();
  if (id === 'flag') {
    g.add(cylinder(0.03, 0.03, 1.4, 0xeeeeee, 0.5, 1.9, -1.0, 5));
    const flag = box(0.5, 0.35, 0.02, accent, 0.77, 2.4, -1.0);
    g.add(flag);
  } else if (id === 'antenna') {
    g.add(cylinder(0.03, 0.03, 1.2, 0xeeeeee, -0.5, 1.8, -1.0, 5));
    g.add(sphere(0.16, accent, -0.5, 2.45, -1.0, 8));
  } else if (id === 'spoiler') {
    const sp = box(1.7, 0.08, 0.4, accent, 0, 1.55, -1.15);
    g.add(sp);
    for (const s of [-1, 1]) g.add(box(0.08, 0.5, 0.3, 0x333333, s * 0.6, 1.3, -1.15));
  } else if (id === 'roof') {
    g.add(cylinder(0.03, 0.03, 1.6, 0xeeeeee, 0, 1.9, -0.3, 5));
    const top = cone(1.1, 0.5, accent, 0, 2.75, -0.3, 10);
    g.add(top);
  }
  return g;
}

/**
 * カートモデルを生成
 * @returns {{group, visual, body, wheels, charGroup, materials, setSteer, setSpin, setHop, setSquash, setStar, update}}
 */
export function buildKartModel(char, kartOpts = {}) {
  const colorDef = KART_COLORS.find((c) => c.id === kartOpts.color) || KART_COLORS[0];
  const kartColor = colorDef.hex ?? char.colors.kart;
  const accent = char.colors.kartAccent;
  const wheelDef = KART_WHEELS.find((w) => w.id === kartOpts.wheels) || KART_WHEELS[0];

  const group = new THREE.Group();
  const visual = new THREE.Group(); // スピン・ホップ・スカッシュ用
  group.add(visual);
  const body = buildKartBody(char.kartBody, kartColor, accent);
  visual.add(body);

  // タイヤ
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(wheelDef.radius, wheelDef.radius, wheelDef.width, 12);
  const hubGeo = new THREE.CylinderGeometry(wheelDef.radius * 0.5, wheelDef.radius * 0.5, wheelDef.width + 0.02, 8);
  const wheelMat = mat(wheelDef.color);
  const hubMat = mat(accent);
  for (const [x, z] of [[-0.8, 0.85], [0.8, 0.85], [-0.8, -0.85], [0.8, -0.85]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, wheelDef.radius, z);
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    const spin = new THREE.Group();
    spin.add(w, hub);
    pivot.add(spin);
    visual.add(pivot);
    wheels.push({ pivot, spin, front: z > 0 });
  }

  // キャラクター
  const builder = CHAR_BUILDERS[char.id] || CHAR_BUILDERS.taro;
  const charGroup = new THREE.Group();
  const charMesh = builder(char.colors);
  charMesh.scale.setScalar(0.95);
  charGroup.add(charMesh);
  charGroup.position.set(0, 0.95, -0.25);
  visual.add(charGroup);

  // アクセサリ
  if (kartOpts.accessory && kartOpts.accessory !== 'none') visual.add(buildAccessory(kartOpts.accessory, accent));

  // 影
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.4, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  group.add(shadow);

  // マテリアル一覧（スター演出用）
  const materials = [];
  visual.traverse((o) => {
    if (o.isMesh && o.material && !materials.includes(o.material)) materials.push(o.material);
  });
  for (const m of materials) m.userData.baseEmissive = m.emissive ? m.emissive.getHex() : 0;

  let wheelAngle = 0;
  const model = {
    group,
    visual,
    body,
    wheels,
    charGroup,
    charMesh,
    shadow,
    materials,
    wheelRadius: wheelDef.radius,
    setSteer(s) {
      for (const w of wheels) if (w.front) w.pivot.rotation.y = -s * 0.45;
    },
    roll(dist) {
      wheelAngle += dist / wheelDef.radius;
      for (const w of wheels) w.spin.rotation.x = wheelAngle;
    },
    setSpin(angle) {
      visual.rotation.y = angle;
    },
    setHop(h) {
      visual.position.y = h;
      shadow.material.opacity = Math.max(0.05, 0.28 - h * 0.08);
    },
    setSquash(f) {
      visual.scale.setScalar(f);
    },
    setStar(time) {
      if (time === null) {
        for (const m of materials) {
          if (m.emissive) m.emissive.setHex(m.userData.baseEmissive);
          m.emissiveIntensity = 1;
        }
        return;
      }
      _tmpColor.setHSL((time * 2) % 1, 1, 0.5);
      for (const m of materials) {
        if (m.emissive) {
          m.emissive.copy(_tmpColor);
          m.emissiveIntensity = 0.7;
        }
      }
    },
    setTilt(roll, pitch = 0) {
      body.rotation.z = roll;
      body.rotation.x = pitch;
      charGroup.rotation.z = roll * 1.6;
      charGroup.rotation.x = pitch * 0.5;
    },
  };
  return model;
}
