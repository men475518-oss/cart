// 追加したステージの検証。
//  - めぐりめぐる遺跡: 1 周ごとに景色（空・地面・路面・ライト）がまるごと入れかわる
//  - からくり工場: しかけが置かれ、実際に動いている
//  - レインボーロード: 路面が虹色に変わり、手すりのない一本道。落ちたら戻され、
//    ドッスンが落ちてきて、1 周ごとに宇宙のべつの場所へ変わる
// 実行: npm run check:stages
import { launchChromium } from './browser.mjs';

const BASE = process.env.SMOKE_URL || 'http://127.0.0.1:4173';
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✔ ' + msg : '  ✘ ' + msg);
  if (!cond) failures++;
};

const browser = await launchChromium(['--autoplay-policy=no-user-gesture-required']);

async function enter(page, courseId) {
  await page.goto(BASE);
  await page.waitForSelector('.title-screen');
  await page.click('.title-screen');
  await page.waitForSelector('.mode-grid');
  await page.click('[data-mode=single]');
  await page.waitForSelector('.char-grid');
  await page.click('[data-act=next]');
  await page.waitForSelector('.course-grid');
  const exists = (await page.$(`.course-card[data-id="${courseId}"]`)) !== null;
  check(exists, `コース一覧に ${courseId} がある`);
  await page.click(`.course-card[data-id="${courseId}"]`);
  await page.waitForSelector('.hud', { timeout: 90000 });
  await page.waitForFunction(() => window.__app?.race?.state === 'racing', null, { timeout: 120000 });
}

// ---------- 1周ごとに景色が変わるコース ----------
{
  console.log('■ めぐりめぐる遺跡（1周ごとに場所が変わる）');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem('mofukart.settings.v1', JSON.stringify({ bgmVolume: 0, sfxVolume: 0, voice: false })));
  await enter(page, 'timeloop');

  const snap = () =>
    page.evaluate(() => {
      const r = window.__app.race;
      return {
        n: r.sceneries.length,
        index: r.themeIndex,
        labels: r.sceneries.map((s) => s.label),
        visibleScenery: r.sceneries.map((s) => s.group.visible),
        visibleTrack: r.sceneries.map((s) => s.mesh.visible),
        sky: r.scene.background.getHex(),
        fog: r.scene.fog.color.getHex(),
        sun: r.lights.sun.color.getHex(),
        sunPower: +r.lights.sun.intensity.toFixed(3),
      };
    });

  const a = await snap();
  check(a.n === 3, `景色が 3 つ用意されている（${a.n}）`);
  check(a.labels.every((l) => l), `それぞれに名前がある（${a.labels.join(' / ')}）`);
  check(a.visibleScenery.filter(Boolean).length === 1, '出ている景色はいつも 1 つだけ');
  check(a.visibleTrack.filter(Boolean).length === 1, '出ている路面もいつも 1 つだけ');

  const seen = [a];
  for (let i = 1; i < 3; i++) {
    await page.evaluate((i) => window.__app.race._setTheme(i), i);
    seen.push(await snap());
  }
  for (let i = 1; i < 3; i++) {
    check(seen[i].index === i, `${i + 1} 周目の景色に切り替わる`);
    check(seen[i].visibleScenery[i] && seen[i].visibleTrack[i], `${i + 1} 周目は ${i + 1} 番目の景色と路面だけが出ている`);
  }
  check(new Set(seen.map((s) => s.sky)).size === 3, `空の色が 3 通りとも変わる（${seen.map((s) => s.sky.toString(16)).join(',')}）`);
  check(new Set(seen.map((s) => s.fog)).size === 3, '遠くのかすみの色も変わる');
  check(new Set(seen.map((s) => `${s.sun}:${s.sunPower}`)).size >= 2, `日ざしの色や強さも変わる（${seen.map((s) => s.sun.toString(16)).join(',')}）`);

  // 実際に周回すると切り替わること（ラップイベント経由）
  await page.evaluate(() => window.__app.race._setTheme(0));
  // イベントは描画ループで処理されるので、切り替わるまで待つ（決め打ちの待ち時間だとたまに落ちる）
  const after = await page.evaluate(async () => {
    const r = window.__app.race;
    const k = r.karts.find((x) => x.isHuman);
    r.events.push({ type: 'lap', kart: k, lap: 1 });
    for (let i = 0; i < 120 && r.themeIndex === 0; i++) await new Promise((res) => requestAnimationFrame(res));
    return r.themeIndex;
  });
  check(after === 1, `1 周まわると次の景色に変わる（${after}）`);
  check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

// ---------- しかけだらけのコース ----------
{
  console.log('■ からくり工場（しかけだらけ）');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem('mofukart.settings.v1', JSON.stringify({ bgmVolume: 0, sfxVolume: 0, voice: false })));
  await enter(page, 'factory');

  const info = await page.evaluate(() => {
    const r = window.__app.race;
    const g = r.gimmicks;
    return { kinds: g.items.map((x) => x.kind), inScene: r.scene.children.includes(g.group), children: g.group.children.length };
  });
  const uniq = [...new Set(info.kinds)];
  check(uniq.length >= 6, `しかけが 6 種類以上ある（${uniq.join(',')}）`);
  check(info.kinds.length >= 10, `しかけの数が 10 個以上（${info.kinds.length}）`);
  check(info.inScene && info.children === info.kinds.length, 'しかけが画面に置かれている');

  // 時間を進めると実際に動く
  const moved = await page.evaluate(() => {
    const g = window.__app.race.gimmicks;
    const pick = (kind) => g.items.find((x) => x.kind === kind);
    const before = {
      roller: pick('roller').slider.position.x,
      gate: pick('gate').doors[0].mesh.position.x,
      pendulum: pick('pendulum').arm.rotation.z,
      fan: pick('fan').blades.rotation.x,
    };
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    return {
      roller: Math.abs(pick('roller').slider.position.x - before.roller),
      gate: Math.abs(pick('gate').doors[0].mesh.position.x - before.gate),
      pendulum: Math.abs(pick('pendulum').arm.rotation.z - before.pendulum),
      fan: Math.abs(pick('fan').blades.rotation.x - before.fan),
    };
  });
  check(moved.roller > 0.5, `丸太が転がって動く（${moved.roller.toFixed(2)}）`);
  check(moved.gate > 0.5, `門が開け閉めする（${moved.gate.toFixed(2)}）`);
  check(moved.pendulum > 0.1, `ふりこがふれる（${moved.pendulum.toFixed(2)}）`);
  check(moved.fan > 1, `送風機の羽根がまわる（${moved.fan.toFixed(2)}）`);

  // 噴きだしは周期的に出たり消えたりする
  const jet = await page.evaluate(() => {
    const g = window.__app.race.gimmicks;
    const gy = g.items.find((x) => x.kind === 'geyser');
    let on = 0, off = 0;
    for (let i = 0; i < 400; i++) {
      g.update(1 / 60);
      if (gy.jet.visible) on++;
      else off++;
    }
    return { on, off };
  });
  check(jet.on > 20 && jet.off > 20, `噴きだしが出たり止まったりする（出 ${jet.on} / 止 ${jet.off} フレーム）`);
  check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

// ---------- レインボーロード ----------
{
  console.log('■ レインボーロード（宇宙に浮いた虹の道）');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => localStorage.setItem('mofukart.settings.v1', JSON.stringify({ bgmVolume: 0, sfxVolume: 0, voice: false })));
  await enter(page, 'rainbow');

  const info = await page.evaluate(() => {
    const r = window.__app.race;
    const sc = r.sceneries[r.themeIndex];
    const road = sc.mesh.getObjectByName('road');
    // RGB -> HSL（THREE を持ちこまずにページ内で計算する）
    const hsl = (rr, gg, bb) => {
      const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb), l = (mx + mn) / 2, d = mx - mn;
      if (d === 0) return { h: 0, s: 0, l };
      const s2 = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      let h = 0;
      if (mx === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
      else if (mx === gg) h = ((bb - rr) / d + 2) / 6;
      else h = ((rr - gg) / d + 4) / 6;
      return { h, s: s2, l };
    };
    const col = road.geometry.getAttribute('color');
    const hues = [];
    const lights = [];
    for (let i = 0; i < col.count; i += Math.max(1, Math.floor(col.count / 400))) {
      const c = hsl(col.getX(i), col.getY(i), col.getZ(i));
      if (c.s > 0.3) hues.push(c.h);
      lights.push(c.l);
    }
    // 手すりの色（真っ黒だと宇宙で道のふちが見えない）
    let railMin = 1;
    const railSet = new Set();
    sc.mesh.traverse((o) => {
      if (!o.isInstancedMesh || !o.instanceColor) return;
      const a = o.instanceColor.array;
      for (let i = 0; i < o.count; i++) {
        const c = hsl(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
        railMin = Math.min(railMin, c.l);
        railSet.add(Math.round(c.h * 12));
      }
    });
    const names = [];
    sc.mesh.traverse((o) => o.name && names.push(o.name));
    let ground = false;
    sc.group.traverse((o) => {
      if (o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters?.width >= 2000 && o.visible) ground = true;
    });
    let rails = 0;
    sc.mesh.traverse((o) => {
      if (o.isInstancedMesh) rails++;
    });
    return {
      hueBuckets: new Set(hues.map((h) => Math.round(h * 10))).size,
      minLight: lights.length ? Math.min(...lights) : 0,
      railMin,
      railHues: railSet.size,
      rails,
      names,
      ground,
      canFall: r.track.canFall,
      themes: r.sceneries.length,
      themeLabels: r.sceneries.map((x) => x.label),
    };
  });
  check(info.hueBuckets >= 8, `路面の色が道にそって虹色に変わる（${info.hueBuckets} 色）`);
  check(info.minLight > 0.15, `路面が真っ黒な場所はない（いちばん暗くて ${info.minLight.toFixed(2)}）`);
  for (const n of ['shoulder', 'wall', 'skirt']) {
    check(!info.names.includes(n), `宇宙なので ${n} の板は出さない`);
  }
  check(info.rails === 0, `手すりがない（${info.rails} 個）`);
  check(!info.ground, '足もとに地面を敷かない');
  check(info.canFall, 'ふちを越えたら落ちるコースになっている');
  check(info.themes === 3, `1 周ごとに変わる景色が 3 つある（${info.themes}）`);
  check(info.themeLabels.every((l) => l), `景色それぞれに名前がある（${info.themeLabels.join(' / ')}）`);

  // 落ちて、しばらくして元の場所に戻ってくる
  const fell = await page.evaluate(async () => {
    const r = window.__app.race;
    const me = r.karts.find((k) => !k.ai) || r.karts[0];
    const st = me.state;
    const before = { index: st.trackIndex, total: st.totalProgress };
    const smp = r.track.samples[st.trackIndex];
    st.x = smp.pos.x + smp.right.x * (r.track.halfWidth + 2);
    st.z = smp.pos.z + smp.right.z * (r.track.halfWidth + 2);
    let sawFalling = false;
    let minY = Infinity;
    for (let i = 0; i < 240; i++) {
      await new Promise((res) => requestAnimationFrame(res));
      if (st.falling) {
        sawFalling = true;
        minY = Math.min(minY, st.y);
      }
      if (sawFalling && !st.falling) break;
    }
    return {
      sawFalling,
      dropped: before.index != null ? minY < r.track.samples[before.index].pos.y - 3 : false,
      back: !st.falling,
      lateral: Math.abs(st.lateral),
      halfWidth: r.track.halfWidth,
      advanced: st.totalProgress - before.total,
    };
  });
  check(fell.sawFalling, 'コースの外に出ると落ちる');
  check(fell.dropped, '実際に下へ落ちていく');
  check(fell.back, '落ちたあと元に戻ってくる');
  check(fell.lateral < fell.halfWidth * 0.6, `戻される場所は道の内側（ふちから ${(fell.halfWidth - fell.lateral).toFixed(1)}m）`);
  check(fell.advanced <= 1, `落ちても先へは進まない（${fell.advanced.toFixed(1)}）`);

  // ドッスンが上下して、下にいるとつぶされる
  const thwomp = await page.evaluate(async () => {
    const r = window.__app.race;
    const me = r.karts.find((k) => !k.ai) || r.karts[0];
    const list = r.gimmicks.items.filter((g) => g.kind === 'thwomp');
    const g = list[0];
    const q = r.track.query({ x: g.node.position.x, y: 0, z: g.node.position.z }, null);
    const smp = r.track.samples[q.index];
    const st = me.state;
    let hi = -Infinity;
    let lo = Infinity;
    let squashed = false;
    for (let i = 0; i < 400; i++) {
      await new Promise((res) => requestAnimationFrame(res));
      // 石の真下に居すわる
      st.x = g.node.position.x;
      st.z = g.node.position.z;
      st.y = smp.pos.y;
      st.speed = 0;
      st.falling = false;
      hi = Math.max(hi, g.body.position.y);
      lo = Math.min(lo, g.body.position.y);
      if (st.squashTime > 0) squashed = true;
    }
    return { count: list.length, hi, lo, squashed };
  });
  check(thwomp.count >= 4, `ドッスンが ${thwomp.count} 個ある`);
  check(thwomp.hi - thwomp.lo > 5, `ドッスンが上下する（幅 ${(thwomp.hi - thwomp.lo).toFixed(1)}）`);
  check(thwomp.squashed, '真下にいるとつぶされる');

  // 画面に実際に何色も出ていること（描画まで通っているかの確認）
  const shot = await page.screenshot({ type: 'png' });
  const px = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const c2 = cv.getContext('2d');
    c2.drawImage(img, 0, 0);
    const d = c2.getImageData(0, 0, cv.width, cv.height).data;
    const buckets = new Set();
    let bright = 0;
    for (let i = 0; i < d.length; i += 4 * 37) {
      const r = d[i] / 255, g = d[i + 1] / 255, bl = d[i + 2] / 255;
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
      if (mx < 0.35 || mx - mn < 0.2) continue;
      bright++;
      let h = 0;
      if (mx === r) h = ((g - bl) / (mx - mn) + 6) % 6;
      else if (mx === g) h = (bl - r) / (mx - mn) + 2;
      else h = (r - g) / (mx - mn) + 4;
      buckets.add(Math.round(h));
    }
    return { buckets: buckets.size, bright };
  }, shot.toString('base64'));
  check(px.bright > 200, `画面が真っ暗ではない（色のついた点 ${px.bright}）`);
  check(px.buckets >= 4, `画面に何色も出ている（${px.buckets} 色）`);
  check(errors.length === 0, `JS エラーなし${errors.length ? ': ' + errors[0] : ''}`);
  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? '\n✅ 追加した 3 ステージ OK' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);
