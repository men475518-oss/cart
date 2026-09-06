// テーマごとの背景・装飾（草原 / ビーチ / 雪山 / 火山 / 夜の街）
import * as THREE from 'three';
import { makeRng } from '../core/Utils.js';
import { toonMat, groundTexture } from './Materials.js';

function skyDome(top, bottom) {
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const colors = [];
  const pos = geo.attributes.position;
  const ct = new THREE.Color(top);
  const cb = new THREE.Color(bottom);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 900; // -1..1
    const t = Math.max(0, Math.min(1, (y + 0.1) / 0.8));
    const c = cb.clone().lerp(ct, Math.pow(t, 0.7));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  return mesh;
}

/** トラックから十分離れたランダム位置を返す */
function makePlacer(track, rng) {
  const b = track.bounds;
  const margin = 150;
  return (minDist, maxDist = 400, tries = 30) => {
    for (let k = 0; k < tries; k++) {
      const x = rng.range(b.min.x - margin, b.max.x + margin);
      const z = rng.range(b.min.z - margin, b.max.z + margin);
      let best = Infinity;
      for (let i = 0; i < track.N; i += 3) {
        const s = track.samples[i];
        const dx = s.pos.x - x;
        const dz = s.pos.z - z;
        const d = dx * dx + dz * dz;
        if (d < best) best = d;
      }
      best = Math.sqrt(best);
      if (best > track.wallDist + minDist && best < track.wallDist + maxDist) return new THREE.Vector3(x, 0, z);
    }
    return null;
  };
}

function instanced(geo, mat, count) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.count = 0;
  m.frustumCulled = false;
  return m;
}
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
function addInstance(mesh, x, y, z, ry = 0, scale = 1, sy = null) {
  if (mesh.count >= mesh.instanceMatrix.count) return;
  _p.set(x, y, z);
  _q.setFromAxisAngle(_up, ry);
  _s.set(scale, sy ?? scale, scale);
  _m4.compose(_p, _q, _s);
  mesh.setMatrixAt(mesh.count++, _m4);
  mesh.instanceMatrix.needsUpdate = true;
}
function addInstanceM(mesh, m4) {
  if (mesh.count >= mesh.instanceMatrix.count) return;
  mesh.setMatrixAt(mesh.count++, m4);
  mesh.instanceMatrix.needsUpdate = true;
}

export function buildScenery(track, course, quality = 'high') {
  const pal = course.palette;
  const group = new THREE.Group();
  const rng = makeRng(1234 + course.id.length * 7);
  const place = makePlacer(track, rng);
  const dense = quality === 'low' ? 0.5 : 1;
  const groundY = track.minY - 0.3;

  group.add(skyDome(pal.skyTop, pal.skyBottom));

  // 地面
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), toonMat(pal.ground, { map: groundTexture(3) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = groundY;
  ground.receiveShadow = true;
  const gt = ground.material.map;
  if (gt) {
    gt.repeat.set(60, 60);
    gt.needsUpdate = true;
  }
  group.add(ground);

  // 太陽 / 月
  const sun = new THREE.Mesh(new THREE.SphereGeometry(28, 16, 12), new THREE.MeshBasicMaterial({ color: pal.night ? 0xfff6c8 : 0xfff2a8, fog: false }));
  sun.position.set(300, 380, -520);
  group.add(sun);

  const anim = []; // 毎フレーム更新するアニメーション関数 (dt, camPos, time)
  const theme = course.theme;

  // 雲（夜以外）
  if (!pal.night) {
    const clouds = instanced(new THREE.SphereGeometry(1, 8, 6), toonMat(0xffffff, { emissive: 0x666666 }), 100);
    for (let i = 0; i < 16 * dense; i++) {
      const cx = rng.range(-500, 500);
      const cz = rng.range(-600, 300);
      const cy = rng.range(90, 160);
      const n = 3 + rng.int(3);
      for (let k = 0; k < n; k++) {
        addInstance(clouds, cx + k * 9 - n * 4, cy + rng.range(-2, 2), cz + rng.range(-3, 3), 0, rng.range(7, 12), rng.range(4, 6));
      }
    }
    group.add(clouds);
    anim.push((dt) => {
      clouds.position.x += dt * 1.5;
      if (clouds.position.x > 300) clouds.position.x = -300;
    });
  }

  if (theme === 'meadow') {
    const trunks = instanced(new THREE.CylinderGeometry(0.35, 0.5, 2.4, 6), toonMat(0x8d5a2b), 200);
    const leaves = instanced(new THREE.SphereGeometry(2.2, 8, 6), toonMat(0x3e9d3a), 600);
    for (let i = 0; i < 90 * dense; i++) {
      const p = place(3, 160);
      if (!p) continue;
      const s = rng.range(0.8, 1.5);
      addInstance(trunks, p.x, groundY + 1.2 * s, p.z, 0, s);
      addInstance(leaves, p.x, groundY + 3.4 * s, p.z, 0, s);
      addInstance(leaves, p.x + 1.2 * s, groundY + 2.6 * s, p.z + 0.6 * s, 0, s * 0.7);
      addInstance(leaves, p.x - 1.0 * s, groundY + 2.8 * s, p.z - 0.8 * s, 0, s * 0.75);
    }
    group.add(trunks, leaves);
    const flowers = instanced(new THREE.SphereGeometry(0.35, 6, 5), toonMat(0xffffff), 400);
    const fcolors = [0xff5c8a, 0xffd23f, 0xffffff, 0xb388ff, 0xff8c42];
    for (let i = 0; i < 300 * dense; i++) {
      const p = place(0.5, 90);
      if (!p) continue;
      addInstance(flowers, p.x, groundY + 0.4, p.z, 0, rng.range(0.7, 1.3));
      flowers.setColorAt(flowers.count - 1, new THREE.Color(rng.pick(fcolors)));
    }
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    group.add(flowers);
    // 風車
    const wm = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2, 3.2, 16, 8), toonMat(0xf1e3c6));
    tower.position.y = 8;
    wm.add(tower);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 3, 8), toonMat(0xc0392b));
    roof.position.y = 17.5;
    wm.add(roof);
    const blades = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7, 0.2), toonMat(0xffffff));
      bl.position.y = 3.5;
      const holder = new THREE.Group();
      holder.add(bl);
      holder.rotation.z = (k * Math.PI) / 2;
      blades.add(holder);
    }
    blades.position.set(0, 13, 3.5);
    wm.add(blades);
    const wp = place(30, 90) || new THREE.Vector3(100, 0, 60);
    wm.position.set(wp.x, groundY, wp.z);
    group.add(wm);
    anim.push((dt) => (blades.rotation.z += dt * 0.8));
  } else if (theme === 'beach') {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), toonMat(0x2f8fe0));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = groundY - 0.15;
    group.add(sea);
    ground.geometry = new THREE.PlaneGeometry(720, 720);
    const trunks = instanced(new THREE.CylinderGeometry(0.28, 0.45, 7, 6), toonMat(0xa0703c), 120);
    const leaves = instanced(new THREE.ConeGeometry(0.9, 4.5, 4), toonMat(0x2fa84f), 800);
    for (let i = 0; i < 70 * dense; i++) {
      const p = place(3, 140);
      if (!p) continue;
      const s = rng.range(0.8, 1.3);
      _p.set(p.x, groundY + 3.5 * s, p.z);
      _q.setFromEuler(new THREE.Euler(rng.range(-0.15, 0.15), rng.range(0, 6.28), 0));
      _s.set(s, s, s);
      _m4.compose(_p, _q, _s);
      addInstanceM(trunks, _m4);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        _p.set(p.x + Math.cos(a) * 1.6 * s, groundY + 7 * s, p.z + Math.sin(a) * 1.6 * s);
        _q.setFromEuler(new THREE.Euler(Math.sin(a) * 1.2, -a, Math.cos(a) * 1.2, 'YXZ'));
        _s.set(s, s, s);
        _m4.compose(_p, _q, _s);
        addInstanceM(leaves, _m4);
      }
    }
    group.add(trunks, leaves);
    const poles = instanced(new THREE.CylinderGeometry(0.08, 0.08, 3, 5), toonMat(0xffffff), 40);
    const tops = instanced(new THREE.ConeGeometry(2.2, 1.1, 8), toonMat(0xffffff), 40);
    const pcolors = [0xff5c5c, 0xffd23f, 0x4cc9f0, 0xff8fb1];
    for (let i = 0; i < 20 * dense; i++) {
      const p = place(2, 60);
      if (!p) continue;
      addInstance(poles, p.x, groundY + 1.5, p.z);
      addInstance(tops, p.x, groundY + 3.1, p.z);
      tops.setColorAt(tops.count - 1, new THREE.Color(rng.pick(pcolors)));
    }
    if (tops.instanceColor) tops.instanceColor.needsUpdate = true;
    group.add(poles, tops);
    const rocks = instanced(new THREE.DodecahedronGeometry(1.4, 0), toonMat(0x8e8e8e), 60);
    for (let i = 0; i < 30 * dense; i++) {
      const p = place(1, 120);
      if (p) addInstance(rocks, p.x, groundY + 0.6, p.z, rng.range(0, 6), rng.range(0.6, 1.6));
    }
    group.add(rocks);
  } else if (theme === 'snow') {
    const trunks = instanced(new THREE.CylinderGeometry(0.3, 0.4, 1.6, 6), toonMat(0x5b3a1e), 200);
    const cones = instanced(new THREE.ConeGeometry(2.2, 4, 7), toonMat(0x2f6b4f), 600);
    const snowCaps = instanced(new THREE.ConeGeometry(1.2, 1.6, 7), toonMat(0xffffff), 200);
    for (let i = 0; i < 110 * dense; i++) {
      const p = place(3, 170);
      if (!p) continue;
      const s = rng.range(0.8, 1.6);
      addInstance(trunks, p.x, groundY + 0.8 * s, p.z, 0, s);
      addInstance(cones, p.x, groundY + 3.2 * s, p.z, 0, s);
      addInstance(cones, p.x, groundY + 5.0 * s, p.z, 0.4, s * 0.75);
      addInstance(snowCaps, p.x, groundY + 6.6 * s, p.z, 0.2, s);
    }
    group.add(trunks, cones, snowCaps);
    const balls = instanced(new THREE.SphereGeometry(1, 10, 8), toonMat(0xffffff), 60);
    const noses = instanced(new THREE.ConeGeometry(0.15, 0.7, 6), toonMat(0xff7f2a), 30);
    for (let i = 0; i < 14 * dense; i++) {
      const p = place(1.5, 70);
      if (!p) continue;
      addInstance(balls, p.x, groundY + 1.1, p.z, 0, 1.2);
      addInstance(balls, p.x, groundY + 2.7, p.z, 0, 0.8);
      const a = rng.range(0, 6.28);
      _p.set(p.x + Math.sin(a) * 0.8, groundY + 2.75, p.z + Math.cos(a) * 0.8);
      _q.setFromEuler(new THREE.Euler(Math.PI / 2, a, 0, 'YXZ'));
      _s.set(1, 1, 1);
      _m4.compose(_p, _q, _s);
      addInstanceM(noses, _m4);
    }
    group.add(balls, noses);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const r = rng.range(380, 520);
      const h = rng.range(120, 220);
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(h * 0.9, h, 6), toonMat(0xd9e8ff));
      mtn.position.set(Math.cos(a) * r, groundY + h / 2 - 5, Math.sin(a) * r);
      group.add(mtn);
    }
    const snowCount = quality === 'low' ? 250 : 600;
    const sp = new Float32Array(snowCount * 3);
    for (let i = 0; i < snowCount; i++) sp.set([rng.range(-250, 250), rng.range(0, 60), rng.range(-300, 100)], i * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, transparent: true, opacity: 0.9 }));
    snow.frustumCulled = false;
    group.add(snow);
    anim.push((dt, camPos) => {
      const arr = sg.attributes.position.array;
      for (let i = 0; i < snowCount; i++) {
        arr[i * 3 + 1] -= dt * 6;
        arr[i * 3] += Math.sin(arr[i * 3 + 1] * 0.5) * dt * 1.5;
        if (arr[i * 3 + 1] < groundY) {
          arr[i * 3 + 1] = 50;
          if (camPos) {
            arr[i * 3] = camPos.x + rng.range(-120, 120);
            arr[i * 3 + 2] = camPos.z + rng.range(-120, 120);
          }
        }
      }
      sg.attributes.position.needsUpdate = true;
    });
  } else if (theme === 'volcano') {
    const volcano = new THREE.Mesh(new THREE.ConeGeometry(220, 240, 9), toonMat(0x3b2323));
    volcano.position.set(-40, groundY + 115, -560);
    group.add(volcano);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(40, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff5a00, fog: false }));
    glow.position.set(-40, groundY + 232, -560);
    group.add(glow);
    anim.push((dt, _c, t) => glow.scale.setScalar(1 + Math.sin(t * 3) * 0.08));
    const rocks = instanced(new THREE.DodecahedronGeometry(1.6, 0), toonMat(0x4a3a3a), 200);
    for (let i = 0; i < 100 * dense; i++) {
      const p = place(1, 160);
      if (p) addInstance(rocks, p.x, groundY + 0.8, p.z, rng.range(0, 6), rng.range(0.6, 2.4));
    }
    group.add(rocks);
    const pools = instanced(new THREE.CircleGeometry(1, 10), new THREE.MeshBasicMaterial({ color: 0xff4e00 }), 60);
    for (let i = 0; i < 30 * dense; i++) {
      const p = place(2, 120);
      if (!p) continue;
      _p.set(p.x, groundY + 0.05, p.z);
      _q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      const r = rng.range(3, 9);
      _s.set(r, r, r);
      _m4.compose(_p, _q, _s);
      addInstanceM(pools, _m4);
    }
    group.add(pools);
    const deadGeo = new THREE.CylinderGeometry(0.2, 0.5, 6, 5);
    const deadMat = toonMat(0x2b1e1e);
    const deads = instanced(deadGeo, deadMat, 40);
    for (let i = 0; i < 20 * dense; i++) {
      const p = place(2, 100);
      if (p) addInstance(deads, p.x, groundY + 3, p.z, rng.range(0, 6));
    }
    group.add(deads);
    const emberCount = quality === 'low' ? 150 : 350;
    const ep = new Float32Array(emberCount * 3);
    for (let i = 0; i < emberCount; i++) ep.set([rng.range(-250, 250), rng.range(0, 40), rng.range(-300, 100)], i * 3);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    const embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xffa040, size: 0.5, transparent: true, opacity: 0.9 }));
    embers.frustumCulled = false;
    group.add(embers);
    anim.push((dt, camPos) => {
      const arr = eg.attributes.position.array;
      for (let i = 0; i < emberCount; i++) {
        arr[i * 3 + 1] += dt * 4;
        arr[i * 3] += Math.sin(arr[i * 3 + 1] + i) * dt * 2;
        if (arr[i * 3 + 1] > 45) {
          arr[i * 3 + 1] = 0;
          if (camPos) {
            arr[i * 3] = camPos.x + rng.range(-100, 100);
            arr[i * 3 + 2] = camPos.z + rng.range(-100, 100);
          }
        }
      }
      eg.attributes.position.needsUpdate = true;
    });
  } else if (theme === 'city') {
    const starCount = 400;
    const sp = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const a = rng.range(0, 6.28);
      const e = rng.range(0.1, 1.4);
      const r = 850;
      sp.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.5, fog: false })));
    // ビル（窓テクスチャ）
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#23233a';
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 128; y += 12) {
      for (let x = 4; x < 64; x += 12) {
        ctx.fillStyle = rng() < 0.55 ? (rng() < 0.5 ? '#fff275' : '#8be9fd') : '#2b2b44';
        ctx.fillRect(x, y, 7, 8);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const bmats = [0x2a2a45, 0x3a2a55, 0x22334d, 0x40304a].map(
      (c) => new THREE.MeshLambertMaterial({ map: tex, color: c, emissive: 0x9a9a6a, emissiveMap: tex, emissiveIntensity: 0.9 })
    );
    const bgeo = new THREE.BoxGeometry(1, 1, 1);
    const buildings = bmats.map((m) => instanced(bgeo, m, 60));
    for (let i = 0; i < 110 * dense; i++) {
      const p = place(4, 200);
      if (!p) continue;
      const w = rng.range(6, 14);
      const h = rng.range(10, 60);
      _p.set(p.x, groundY + h / 2, p.z);
      _q.setFromAxisAngle(_up, rng.range(0, 6.28));
      _s.set(w, h, w);
      _m4.compose(_p, _q, _s);
      addInstanceM(buildings[rng.int(buildings.length)], _m4);
    }
    group.add(...buildings);
    const neonColors = [0xff2e88, 0x33e1ff, 0xfff275, 0x7bff7b, 0xc86bff];
    const neonMeshes = [];
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 1, 5);
    const poleMat = toonMat(0x555566);
    for (let i = 0; i < 28 * dense; i++) {
      const p = place(1, 40);
      if (!p) continue;
      const n = new THREE.Mesh(new THREE.PlaneGeometry(rng.range(3, 6), rng.range(1.5, 3)), new THREE.MeshBasicMaterial({ color: rng.pick(neonColors), side: THREE.DoubleSide, transparent: true }));
      const h = rng.range(3, 9);
      n.position.set(p.x, groundY + h, p.z);
      n.rotation.y = rng.range(0, 6.28);
      group.add(n);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.scale.y = h;
      pole.position.set(p.x, groundY + h / 2, p.z);
      group.add(pole);
      neonMeshes.push(n);
    }
    anim.push((dt, _c, t) => {
      for (let i = 0; i < neonMeshes.length; i++) neonMeshes[i].material.opacity = 0.7 + 0.3 * Math.sin(t * 4 + i);
    });
    const lamps = instanced(new THREE.CylinderGeometry(0.12, 0.16, 5, 5), toonMat(0x8888aa), 120);
    const bulbs = instanced(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }), 120);
    for (let i = 0; i < track.N; i += 14) {
      const s = track.samples[i];
      const side = (i / 14) % 2 === 0 ? -1 : 1;
      const p = s.pos.clone().addScaledVector(s.right, side * (track.wallDist + 1.2));
      addInstance(lamps, p.x, p.y + 2.5, p.z);
      addInstance(bulbs, p.x, p.y + 5.1, p.z);
    }
    group.add(lamps, bulbs);
  } else if (theme === 'factory') {
    // 工場: 煙突・タンク・パイプ・クレーン
    const bodies = instanced(new THREE.CylinderGeometry(1, 1, 1, 10), toonMat(0xb9bec7), 90);
    const tops = instanced(new THREE.CylinderGeometry(1.15, 1.15, 0.5, 10), toonMat(0xff9f1c), 90);
    const tanks = instanced(new THREE.CylinderGeometry(1, 1, 1, 12), toonMat(0xcfd6de), 60);
    const blocks = instanced(new THREE.BoxGeometry(1, 1, 1), toonMat(0x8d949e), 120);
    const smoke = instanced(new THREE.SphereGeometry(1, 7, 5), toonMat(0xeceff3, { transparent: true, opacity: 0.75 }), 140);
    const puffs = [];
    for (let i = 0; i < 26 * dense; i++) {
      const p = place(18, 46);
      if (!p) continue;
      if (i % 3 === 0) {
        // 煙突
        const h = rng.range(10, 20);
        addInstance(bodies, p.x, groundY + h / 2, p.z, 0, rng.range(1.4, 2.4), h);
        addInstance(tops, p.x, groundY + h, p.z, 0, rng.range(1.4, 2.4));
        puffs.push({ x: p.x, y: groundY + h + 1, z: p.z, t: rng.range(0, 1) });
      } else if (i % 3 === 1) {
        // 貯蔵タンク
        const h = rng.range(5, 9);
        addInstance(tanks, p.x, groundY + h / 2, p.z, 0, rng.range(3, 5), h);
      } else {
        // 建屋
        const h = rng.range(4, 10);
        addInstance(blocks, p.x, groundY + h / 2, p.z, rng.range(0, 3), rng.range(6, 14), h);
      }
    }
    group.add(bodies, tops, tanks, blocks, smoke);
    // 煙突から立ちのぼる煙
    anim.push((dt, _c, t) => {
      smoke.count = 0;
      for (const q of puffs) {
        for (let k = 0; k < 4; k++) {
          const ph = ((t * 0.28 + q.t + k * 0.25) % 1);
          addInstance(smoke, q.x + Math.sin(ph * 5 + q.t * 9) * ph * 6, q.y + ph * 16, q.z, 0, 1.4 + ph * 4.5);
        }
      }
      smoke.instanceMatrix.needsUpdate = true;
    });
    // 道ぞいのパイプライン
    const pipes = instanced(new THREE.CylinderGeometry(0.35, 0.35, 1, 8), toonMat(0xffb703), 200);
    const props = instanced(new THREE.BoxGeometry(0.5, 1, 0.5), toonMat(0x6b7079), 200);
    for (let i = 0; i < track.N; i += 10) {
      const smp = track.samples[i];
      const nx = track.samples[(i + 10) % track.N];
      const side = (i / 10) % 2 === 0 ? -1 : 1;
      const a = smp.pos.clone().addScaledVector(smp.right, side * (track.wallDist + 2.4));
      const b = nx.pos.clone().addScaledVector(nx.right, side * (track.wallDist + 2.4));
      const len = a.distanceTo(b);
      const m = new THREE.Matrix4();
      const mid = a.clone().lerp(b, 0.5);
      m.compose(
        new THREE.Vector3(mid.x, mid.y + 1.8, mid.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2).premultiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(b.x - a.x, b.z - a.z))
        ),
        new THREE.Vector3(1, len, 1)
      );
      addInstanceM(pipes, m);
      addInstance(props, a.x, a.y + 0.9, a.z, 0, 1, 1.8);
    }
    group.add(pipes, props);
  }

  // 共通: スタート付近の風船
  const s0 = track.samples[0];
  const balloons = instanced(new THREE.SphereGeometry(0.9, 8, 6), toonMat(0xffffff), 40);
  const bcolors = [0xff5c8a, 0xffd23f, 0x4cc9f0, 0x7bff7b, 0xc86bff];
  for (let i = 0; i < 16; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const s = track.samples[(i * 3 + track.N - 20) % track.N];
    const p = s.pos.clone().addScaledVector(s.right, side * (track.wallDist + 2.5));
    addInstance(balloons, p.x, p.y + 3 + (i % 3), p.z);
    balloons.setColorAt(i, new THREE.Color(bcolors[i % bcolors.length]));
  }
  if (balloons.instanceColor) balloons.instanceColor.needsUpdate = true;
  group.add(balloons);
  anim.push((dt, _c, t) => {
    balloons.position.y = Math.sin(t * 1.5) * 0.4;
  });

  // スタートゲート
  const gate = new THREE.Group();
  const gm = toonMat(0xffffff);
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 8, 8), gm);
    pole.position.set(side * (track.halfWidth + 1.5), 4, 0);
    gate.add(pole);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(track.width + 4, 1.6, 0.4), toonMat(0xff4d6d));
  banner.position.y = 7.6;
  gate.add(banner);
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = 512;
  bannerCanvas.height = 64;
  const bctx = bannerCanvas.getContext('2d');
  bctx.fillStyle = '#ff4d6d';
  bctx.fillRect(0, 0, 512, 64);
  bctx.fillStyle = '#ffffff';
  bctx.font = 'bold 44px sans-serif';
  bctx.textAlign = 'center';
  bctx.fillText('もふもふカート', 256, 48);
  const btex = new THREE.CanvasTexture(bannerCanvas);
  btex.colorSpace = THREE.SRGBColorSpace;
  const bannerFace = new THREE.Mesh(new THREE.PlaneGeometry(track.width + 4, 1.6), new THREE.MeshBasicMaterial({ map: btex }));
  bannerFace.position.set(0, 7.6, 0.21);
  gate.add(bannerFace);
  const bannerBack = bannerFace.clone();
  bannerBack.position.z = -0.21;
  bannerBack.rotation.y = Math.PI;
  gate.add(bannerBack);
  gate.position.copy(s0.pos);
  gate.rotation.y = s0.heading;
  group.add(gate);

  return { group, anim };
}

/**
 * ライティング。太陽光はカメラの周りだけ影を落とす（範囲を絞って解像度を稼ぐ）。
 * 戻り値の update(camPos) を毎フレーム呼ぶと影の範囲が追従する。
 */
export function buildLights(palette, quality = 'high') {
  const g = new THREE.Group();
  // 合計の明るさは 1.6 前後に抑える。強すぎると色が白飛びしてポップさが消える
  g.add(new THREE.HemisphereLight(palette.hemiSky, palette.hemiGround, palette.night ? 0.45 : 0.55));
  const sun = new THREE.DirectionalLight(palette.sun, palette.sunIntensity * 0.62);
  sun.position.set(60, 90, -40);
  g.add(sun);
  g.add(sun.target);
  if (quality !== 'low') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const d = 42;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0016;
    sun.shadow.normalBias = 0.03;
  }
  g.add(new THREE.AmbientLight(0xffffff, palette.night ? 0.16 : 0.2));
  const hemi = g.children[0];
  const ambient = g.children.find((c) => c.isAmbientLight);
  return {
    group: g,
    sun,
    /** 周回で景色が変わるコース用。ライトの色と強さを差し替える */
    setPalette(p) {
      hemi.color.set(p.hemiSky);
      hemi.groundColor.set(p.hemiGround);
      hemi.intensity = p.night ? 0.45 : 0.55;
      sun.color.set(p.sun);
      sun.intensity = p.sunIntensity * 0.62;
      if (ambient) ambient.intensity = p.night ? 0.16 : 0.2;
    },
    update(camPos) {
      if (!camPos || !sun.castShadow) return;
      sun.target.position.set(camPos.x, 0, camPos.z);
      sun.position.set(camPos.x + 60, 90, camPos.z - 40);
      sun.target.updateMatrixWorld();
    },
  };
}
