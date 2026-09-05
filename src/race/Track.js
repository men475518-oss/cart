// トラック: スプラインからサンプル列・サーフェス・メッシュを生成し、位置クエリを提供する
import * as THREE from 'three';
import { clamp } from '../core/Utils.js';

export const SHOULDER_WIDTH = 7;   // 路肩（減速ゾーン）の幅
export const WALL_HEIGHT = 1.1;
const CURB_WIDTH = 0.9;

export class Track {
  constructor(def) {
    this.def = def;
    this.width = def.width;
    this.halfWidth = def.width / 2;
    this.wallDist = this.halfWidth + SHOULDER_WIDTH; // 中心からの壁までの距離
    const pts = def.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    this.curve.arcLengthDivisions = 2000;
    this.length = this.curve.getLength();
    this.N = Math.max(240, Math.round(this.length / 1.5));
    this.segLen = this.length / this.N;
    this._buildSamples();
    this._buildSurfaces();
    this.itemBoxSpots = this._resolveItemBoxes();
    this.boostPads = this._resolveBoosts();
  }

  /** 制御点インデックス（小数可）→ 弧長パラメータ u(0..1) */
  cpToU(cp) {
    const n = this.def.points.length;
    const t = (((cp % n) + n) % n) / n;
    // CatmullRom の t（非弧長）→ u（弧長）変換
    const lengths = this.curve.getLengths(this.curve.arcLengthDivisions);
    const total = lengths[lengths.length - 1];
    const idx = t * this.curve.arcLengthDivisions;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, lengths.length - 1);
    const l = lengths[i0] + (lengths[i1] - lengths[i0]) * (idx - i0);
    return l / total;
  }
  cpToIndex(cp) {
    return Math.round(this.cpToU(cp) * this.N) % this.N;
  }

  _buildSamples() {
    const N = this.N;
    this.samples = new Array(N);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const pos = this.curve.getPointAt(u);
      const tan = this.curve.getTangentAt(u);
      tan.y = 0;
      tan.normalize();
      const right = new THREE.Vector3().crossVectors(tan, up).normalize();
      this.samples[i] = { i, pos, tan, right, heading: Math.atan2(tan.x, tan.z), surface: 'road', surfLat: null };
    }
    // 曲率（AI 用）: 前後の向きの差
    for (let i = 0; i < N; i++) {
      const a = this.samples[(i + N - 3) % N].heading;
      const b = this.samples[(i + 3) % N].heading;
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.samples[i].curvature = d / (6 * this.segLen);
    }
    this.minY = Math.min(...this.samples.map((s) => s.pos.y));
    // バウンディング（ミニマップ用）
    const b = new THREE.Box3();
    for (const s of this.samples) b.expandByPoint(s.pos);
    this.bounds = b;
  }

  _buildSurfaces() {
    for (const s of this.def.surfaces || []) {
      const a = this.cpToIndex(s.from);
      const b = this.cpToIndex(s.to);
      let i = a;
      let guard = 0;
      while (i !== b && guard++ < this.N) {
        this.samples[i].surface = s.type;
        this.samples[i].surfLat = s.lat || null;
        i = (i + 1) % this.N;
      }
    }
  }

  _resolveItemBoxes() {
    const spots = [];
    for (const ib of this.def.itemBoxes || []) {
      const idx = this.cpToIndex(ib.at);
      const s = this.samples[idx];
      for (const lane of ib.lanes) {
        const lat = lane * this.halfWidth * 0.6;
        const p = s.pos.clone().addScaledVector(s.right, lat);
        p.y += 1.2;
        spots.push({ pos: p, index: idx, lateral: lat });
      }
    }
    return spots;
  }

  _resolveBoosts() {
    const pads = [];
    for (const b of this.def.boosts || []) {
      const idx = this.cpToIndex(b.at);
      pads.push({ index: idx, lateral: (b.lane || 0) * this.halfWidth * 0.6, halfW: Math.min(3.2, this.halfWidth * 0.45), len: 5 });
      for (let k = -3; k <= 3; k++) {
        const s = this.samples[(idx + k + this.N) % this.N];
        s.boost = { lat: (b.lane || 0) * this.halfWidth * 0.6, halfW: Math.min(3.2, this.halfWidth * 0.45) };
      }
    }
    return pads;
  }

  sample(i) {
    return this.samples[((i % this.N) + this.N) % this.N];
  }

  /** ワールド座標 → トラック情報。hint は前回のインデックス（近傍探索） */
  query(pos, hint = null, out = {}) {
    const N = this.N;
    let best = -1;
    let bestD = Infinity;
    const search = (from, to) => {
      for (let k = from; k <= to; k++) {
        const s = this.samples[((k % N) + N) % N];
        const dx = pos.x - s.pos.x;
        const dz = pos.z - s.pos.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = ((k % N) + N) % N;
        }
      }
    };
    if (hint === null || hint === undefined) search(0, N - 1);
    else {
      search(hint - 40, hint + 40);
      // 極端に遠い場合は全探索（ワープ・リスポーン対策）
      if (bestD > 60 * 60) search(0, N - 1);
    }
    const s = this.samples[best];
    const dx = pos.x - s.pos.x;
    const dz = pos.z - s.pos.z;
    const along = dx * s.tan.x + dz * s.tan.z; // サンプル点からの前後オフセット
    const lateral = dx * s.right.x + dz * s.right.z;
    const frac = clamp(along / this.segLen, -1, 1);
    const nb = frac >= 0 ? this.samples[(best + 1) % N] : this.samples[(best + N - 1) % N];
    const y = s.pos.y + (nb.pos.y - s.pos.y) * Math.abs(frac);
    out.index = best;
    out.progress = best + frac; // 連続的な進行度（サンプル単位）
    out.lateral = lateral;
    out.height = y;
    out.tan = s.tan;
    out.right = s.right;
    out.heading = s.heading;
    let surface = s.surface;
    if (surface !== 'road' && s.surfLat) {
      const l = lateral / this.halfWidth;
      if (l < s.surfLat[0] || l > s.surfLat[1]) surface = 'road';
    }
    const absLat = Math.abs(lateral);
    if (absLat > this.halfWidth) surface = absLat > this.wallDist ? 'wall' : 'offroad';
    out.surface = surface;
    out.onBoost = !!(s.boost && Math.abs(lateral - s.boost.lat) < s.boost.halfW && absLat <= this.halfWidth);
    out.curvature = s.curvature;
    return out;
  }

  /** スタートグリッド位置 */
  gridSlot(k) {
    const row = Math.floor(k / 2);
    const col = k % 2 === 0 ? -1 : 1;
    const idx = (this.N - 6 - row * 4 + this.N) % this.N;
    const s = this.samples[idx];
    const pos = s.pos.clone().addScaledVector(s.right, col * this.halfWidth * 0.4);
    return { pos, heading: s.heading, index: idx };
  }

  // ---------- メッシュ生成 ----------
  buildMesh(palette) {
    const group = new THREE.Group();
    const N = this.N;
    const hw = this.halfWidth;
    const wd = this.wallDist;
    const roadColor = new THREE.Color(palette.road);
    const curbA = new THREE.Color(palette.curbA);
    const curbB = new THREE.Color(palette.curbB);
    const lineColor = new THREE.Color(palette.roadLine);
    const shoulderColor = new THREE.Color(palette.shoulder);
    const surfColors = {
      ice: new THREE.Color(palette.ice || 0xbfe9ff),
      water: new THREE.Color(palette.water || 0x3fb7ff),
      lava: new THREE.Color(palette.lava || 0xff4e00),
    };

    // 路面: 1サンプルあたり 6 頂点 [縁石外L, 縁石内L, 中央線L, 中央線R, 縁石内R, 縁石外R]
    const RV = 6;
    const pos = new Float32Array(N * RV * 3);
    const col = new Float32Array(N * RV * 3);
    const lateralOf = [-hw, -hw + CURB_WIDTH, -0.25, 0.25, hw - CURB_WIDTH, hw];
    for (let i = 0; i < N; i++) {
      const s = this.samples[i];
      const curb = Math.floor(i / 4) % 2 === 0 ? curbA : curbB;
      for (let v = 0; v < RV; v++) {
        const lat = lateralOf[v];
        const p = s.pos.clone().addScaledVector(s.right, lat);
        p.y += 0.02;
        pos.set([p.x, p.y, p.z], (i * RV + v) * 3);
        let c = roadColor;
        if (v === 0 || v === 1 || v === 4 || v === 5) c = curb;
        else if (v === 2 || v === 3) c = Math.floor(i / 6) % 2 === 0 ? lineColor : roadColor;
        if (s.surface !== 'road' && (v === 2 || v === 3)) {
          const sl = s.surfLat;
          const l = lat / hw;
          if (!sl || (l >= sl[0] && l <= sl[1])) c = surfColors[s.surface] || roadColor;
        }
        col.set([c.r, c.g, c.b], (i * RV + v) * 3);
      }
    }
    const idx = [];
    for (let i = 0; i < N; i++) {
      const a = i * RV;
      const b = ((i + 1) % N) * RV;
      for (let v = 0; v < RV - 1; v++) {
        idx.push(a + v, b + v, a + v + 1, a + v + 1, b + v, b + v + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const road = new THREE.Mesh(geo, roadMat);
    road.name = 'road';
    group.add(road);

    // 特殊サーフェス（水・氷・溶岩）は路面全体を覆うオーバーレイで描く（lat 指定がある場合はその範囲）
    const overlays = { ice: [], water: [], lava: [] };
    for (let i = 0; i < N; i++) {
      const s = this.samples[i];
      if (s.surface !== 'road' && overlays[s.surface]) overlays[s.surface].push(i);
    }
    for (const type of Object.keys(overlays)) {
      const list = overlays[type];
      if (!list.length) continue;
      const opos = [];
      const oidx = [];
      let vi = 0;
      for (const i of list) {
        const s = this.samples[i];
        const s2 = this.samples[(i + 1) % N];
        const sl = s.surfLat || [-1, 1];
        const l0 = sl[0] * hw;
        const l1 = sl[1] * hw;
        const yOff = type === 'water' ? 0.12 : type === 'lava' ? 0.1 : 0.05;
        for (const [ss, lat] of [[s, l0], [s, l1], [s2, l0], [s2, l1]]) {
          const p = ss.pos.clone().addScaledVector(ss.right, lat);
          opos.push(p.x, p.y + yOff, p.z);
        }
        oidx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
        vi += 4;
      }
      const og = new THREE.BufferGeometry();
      og.setAttribute('position', new THREE.Float32BufferAttribute(opos, 3));
      og.setIndex(oidx);
      og.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({
        color: surfColors[type],
        transparent: type !== 'lava',
        opacity: type === 'water' ? 0.75 : 0.85,
        emissive: type === 'lava' ? new THREE.Color(0xff3300) : new THREE.Color(0x000000),
        emissiveIntensity: type === 'lava' ? 0.8 : 0,
      });
      const m = new THREE.Mesh(og, mat);
      m.name = `surface-${type}`;
      m.userData.surfaceType = type;
      group.add(m);
    }

    // 路肩（左右）＋ 壁 ＋ スカート
    const SV = 4; // [壁上L, 路肩外L(壁下), 路肩外R, 壁上R] を分けて作る
    const shPos = [];
    const shCol = [];
    const shIdx = [];
    const wallPos = [];
    const wallIdx = [];
    const skirtPos = [];
    const skirtIdx = [];
    let sv = 0;
    let wv = 0;
    let kv = 0;
    const groundY = this.minY - 0.3;
    for (let i = 0; i < N; i++) {
      const s = this.samples[i];
      const s2 = this.samples[(i + 1) % N];
      for (const side of [-1, 1]) {
        // 路肩
        for (const ss of [s, s2]) {
          const a = ss.pos.clone().addScaledVector(ss.right, side * hw);
          const b = ss.pos.clone().addScaledVector(ss.right, side * wd);
          shPos.push(a.x, a.y, a.z, b.x, b.y, b.z);
          shCol.push(shoulderColor.r, shoulderColor.g, shoulderColor.b, shoulderColor.r * 0.9, shoulderColor.g * 0.9, shoulderColor.b * 0.9);
        }
        if (side < 0) shIdx.push(sv, sv + 1, sv + 2, sv + 1, sv + 3, sv + 2);
        else shIdx.push(sv, sv + 2, sv + 1, sv + 1, sv + 2, sv + 3);
        sv += 4;
        // 壁
        for (const ss of [s, s2]) {
          const b = ss.pos.clone().addScaledVector(ss.right, side * wd);
          wallPos.push(b.x, b.y, b.z, b.x, b.y + WALL_HEIGHT, b.z);
        }
        if (side < 0) wallIdx.push(wv, wv + 2, wv + 1, wv + 1, wv + 2, wv + 3);
        else wallIdx.push(wv, wv + 1, wv + 2, wv + 1, wv + 3, wv + 2);
        wv += 4;
        // スカート（地面まで）
        for (const ss of [s, s2]) {
          const b = ss.pos.clone().addScaledVector(ss.right, side * (wd + 0.2));
          const c = ss.pos.clone().addScaledVector(ss.right, side * (wd + 6));
          skirtPos.push(b.x, b.y, b.z, c.x, groundY, c.z);
        }
        if (side < 0) skirtIdx.push(kv, kv + 1, kv + 2, kv + 1, kv + 3, kv + 2);
        else skirtIdx.push(kv, kv + 2, kv + 1, kv + 1, kv + 2, kv + 3);
        kv += 4;
      }
    }
    const shGeo = new THREE.BufferGeometry();
    shGeo.setAttribute('position', new THREE.Float32BufferAttribute(shPos, 3));
    shGeo.setAttribute('color', new THREE.Float32BufferAttribute(shCol, 3));
    shGeo.setIndex(shIdx);
    shGeo.computeVertexNormals();
    const shoulder = new THREE.Mesh(shGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    shoulder.name = 'shoulder';
    group.add(shoulder);

    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
    wallGeo.setIndex(wallIdx);
    wallGeo.computeVertexNormals();
    const wall = new THREE.Mesh(wallGeo, new THREE.MeshLambertMaterial({ color: palette.wall, side: THREE.DoubleSide }));
    wall.name = 'wall';
    group.add(wall);

    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
    skirtGeo.setIndex(skirtIdx);
    skirtGeo.computeVertexNormals();
    const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshLambertMaterial({ color: palette.ground, side: THREE.DoubleSide }));
    skirt.name = 'skirt';
    group.add(skirt);

    // スタートライン（市松模様）
    const s0 = this.samples[0];
    const cells = 8;
    const cellW = this.width / cells;
    const cellL = 1.2;
    const startGroup = new THREE.Group();
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cells; c++) {
        const g = new THREE.PlaneGeometry(cellW, cellL);
        const m = new THREE.MeshBasicMaterial({ color: (r + c) % 2 === 0 ? 0xffffff : 0x111111 });
        const mesh = new THREE.Mesh(g, m);
        const lat = -hw + cellW * (c + 0.5);
        const p = s0.pos.clone().addScaledVector(s0.right, lat).addScaledVector(s0.tan, (r - 0.5) * cellL);
        mesh.position.set(p.x, p.y + 0.06, p.z);
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = -s0.heading;
        startGroup.add(mesh);
      }
    }
    group.add(startGroup);

    // ダッシュ板
    for (const pad of this.boostPads) {
      const s = this.samples[pad.index];
      const g = new THREE.PlaneGeometry(pad.halfW * 2, pad.len);
      const m = new THREE.MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(g, m);
      const p = s.pos.clone().addScaledVector(s.right, pad.lateral);
      mesh.position.set(p.x, p.y + 0.07, p.z);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = -s.heading;
      mesh.userData.boostPad = true;
      group.add(mesh);
      // 矢印（3本の三角）
      for (let k = -1; k <= 1; k++) {
        const ag = new THREE.ConeGeometry(pad.halfW * 0.5, 1.4, 3);
        const am = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const arrow = new THREE.Mesh(ag, am);
        arrow.rotation.x = Math.PI / 2;
        arrow.rotation.z = 0;
        const ap = p.clone().addScaledVector(s.tan, k * 1.5);
        arrow.position.set(ap.x, ap.y + 0.1, ap.z);
        arrow.rotation.set(-Math.PI / 2, 0, -s.heading + Math.PI);
        arrow.scale.y = 0.6;
        arrow.rotateX(0);
        arrow.userData.boostArrow = true;
        group.add(arrow);
      }
    }
    return group;
  }
}
