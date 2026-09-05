// Cloudflare Worker 版の対戦サーバーを、Node 版と同じプロトコルで検証する。
//
// 使い方:
//   npx wrangler dev --port 8788 --local     （別ターミナルで起動しておく）
//   node test/worker.mjs
import WebSocket from 'ws';

const URL_BASE = process.env.WORKER_URL || 'ws://127.0.0.1:8788';
let failures = 0;
const check = (cond, msg) => {
  console.log(cond ? '  ✔ ' + msg : '  ✘ ' + msg);
  if (!cond) failures++;
};

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL_BASE);
    const inbox = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const i = waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
      else inbox.push(msg);
    });
    ws.on('error', reject);
    const client = {
      ws,
      id: null,
      name,
      send: (o) => ws.send(JSON.stringify(o)),
      next: (pred, ms = 6000) =>
        new Promise((res, rej) => {
          const i = inbox.findIndex(pred);
          if (i >= 0) return res(inbox.splice(i, 1)[0]);
          const waiter = {
            pred,
            resolve: (m) => {
              clearTimeout(waiter.timer);
              res(m);
            },
          };
          // タイムアウトした待ち受けを残すと、後から届いたメッセージを横取りしてしまう
          waiter.timer = setTimeout(() => {
            const at = waiters.indexOf(waiter);
            if (at >= 0) waiters.splice(at, 1);
            rej(new Error('timeout'));
          }, ms);
          waiters.push(waiter);
        }),
      /** 指定時間内にそのメッセージが「来ないこと」を確認する */
      none: async (pred, ms = 700) => {
        try {
          await client.next(pred, ms);
          return false;
        } catch (e) {
          return true;
        }
      },
      close: () => ws.close(),
    };
    ws.on('open', async () => {
      client.send({ t: 'hello', name });
      const w = await client.next((m) => m.t === 'welcome');
      client.id = w.id;
      resolve(client);
    });
  });
}

console.log('接続先:', URL_BASE);

// ---------- 1. 接続と応答 ----------
console.log('■ 接続・ping');
const host = await connect('ホスト');
const guest = await connect('ゲスト');
check(!!host.id && !!guest.id && host.id !== guest.id, `welcome で別々の ID が割り当てられる (${host.id}, ${guest.id})`);
host.send({ t: 'ping', ts: 12345 });
const pong = await host.next((m) => m.t === 'pong');
check(pong.ts === 12345 && typeof pong.now === 'number', 'ping に pong が返る');

// ---------- 2. 部屋の作成と参加 ----------
console.log('■ プライベートマッチ');
host.send({ t: 'create', name: 'ホスト', char: 'taro', kart: { color: 'red', wheels: 'slick', accessory: 'flag' } });
const created = await host.next((m) => m.t === 'room');
check(/^[A-Z0-9]{4}$/.test(created.room.code), `4 文字のルームコードが発行される (${created.room.code})`);
check(created.room.hostId === host.id, '作成者がホストになる');

guest.send({ t: 'join', code: created.room.code, name: 'ゲスト', char: 'don' });
const joined = await guest.next((m) => m.t === 'room' && m.room.players.length === 2);
await host.next((m) => m.t === 'room' && m.room.players.length === 2);
check(joined.room.players.length === 2, '2 人が同じ部屋に入る');
check(joined.room.players.find((p) => p.id === host.id).kart.color === 'red', 'カートのカスタマイズが共有される');

// 存在しないコード
guest.send({ t: 'join', code: 'ZZZZ' });
const err = await guest.next((m) => m.t === 'error');
check(err.code === 'notfound', '存在しない部屋はエラーになる');

// ---------- 3. 準備完了とレース開始 ----------
console.log('■ レース開始');
guest.send({ t: 'ready', ready: true });
const readyView = await host.next((m) => m.t === 'room' && m.room.players.find((p) => p.id === guest.id)?.ready);
check(!!readyView, 'ゲストの準備完了がホストに伝わる');

guest.send({ t: 'start', course: 'city', cpuCount: 8 });
check(await guest.none((m) => m.t === 'start'), 'ホスト以外はレースを開始できない');

host.send({ t: 'setCourse', course: 'snow', laps: 2 });
await host.next((m) => m.t === 'room' && m.room.course === 'snow');
check(true, 'ホストはコースと周回数を変更できる');

host.send({ t: 'start', course: 'city', laps: 2, cpuCount: 8 });
const [sh, sg] = await Promise.all([host.next((m) => m.t === 'start'), guest.next((m) => m.t === 'start')]);
check(sh.course === 'city' && sh.laps === 2, 'コースと周回数が反映される');
check(sh.players.length === 8 && sh.players.filter((p) => p.cpu).length === 6, 'CPU で 8 人に補充される');
check(sh.seed === sg.seed, '全員が同じ乱数シードを受け取る');
check(new Set(sh.players.map((p) => p.char)).size === 8, 'キャラクターが重複しない');

// ---------- 4. 走行データの中継と なりすまし防止 ----------
console.log('■ 走行データの中継');
const cpuId = sh.players.find((p) => p.cpu).id;
host.send({ t: 'state', id: cpuId, s: { x: 1, z: 2, h: 0, v: 10, tp: 5 } });
const relayed = await guest.next((m) => m.t === 'state' && m.id === cpuId);
check(relayed.s.tp === 5, 'ホストが動かす CPU の位置がゲストに届く');

guest.send({ t: 'state', id: cpuId, s: { x: 999 } });
check(await host.none((m) => m.t === 'state' && m.id === cpuId), 'ゲストは CPU になりすませない');

guest.send({ t: 'state', id: host.id, s: { x: 999 } });
check(await host.none((m) => m.t === 'state' && m.id === host.id), 'ゲストは他人になりすませない');

guest.send({ t: 'state', id: guest.id, s: { x: 3, z: 4, h: 0, v: 20, tp: 7 } });
const gs = await host.next((m) => m.t === 'state' && m.id === guest.id);
check(gs.s.x === 3, '自分の位置は相手に届く');

host.send({ t: 'event', e: { k: 'spawn', desc: { id: 'h1', type: 'banana', x: 0, z: 0, heading: 0, ownerId: host.id } } });
const ev = await guest.next((m) => m.t === 'event' && m.e.k === 'spawn');
check(ev.id === host.id, 'アイテム使用イベントが中継される');

// ---------- 5. ゴールと結果確定 ----------
console.log('■ ゴールと順位確定');
host.send({ t: 'event', e: { k: 'finish', id: host.id, time: 61.5 } });
guest.send({ t: 'event', e: { k: 'finish', id: guest.id, time: 60.2 } });
for (const p of sh.players.filter((p) => p.cpu)) host.send({ t: 'event', e: { k: 'finish', id: p.id, time: 70 + Math.random() } });
const res = await host.next((m) => m.t === 'results', 15000);
check(res.results.length === 8, '8 人分の結果が返る');
check(res.results[0].id === guest.id && res.results[0].rank === 1, 'タイムが速い方が 1 位になる');
check(res.results[1].id === host.id, '2 位も正しい');
const lobby = await host.next((m) => m.t === 'room' && m.room.status === 'lobby');
check(lobby.room.players.every((p) => !p.ready || p.cpu), 'レース後はロビーに戻り準備状態がリセットされる');

// ---------- 6. 観戦 ----------
console.log('■ 観戦');
const spec = await connect('観戦者');
spec.send({ t: 'spectate', code: created.room.code });
const view = await spec.next((m) => m.t === 'room' && m.spectating);
check(view.spectating === true && view.room.code === created.room.code, '観戦者として部屋に入れる');
const withSpec = await host.next((m) => m.t === 'room' && m.room.spectators === 1);
check(withSpec.room.spectators === 1, '観戦者の人数がホストに見える');
host.send({ t: 'start', course: 'beach', cpuCount: 4 });
const specStart = await spec.next((m) => m.t === 'start');
check(specStart.course === 'beach', '観戦者にもレース開始が届く');

// ---------- 7. 退出 ----------
console.log('■ 退出とホスト交代');
host.close();
const left = await guest.next((m) => m.t === 'left' && m.id === host.id, 8000);
check(!!left, 'ホストの切断が通知される');
const newHost = await guest.next((m) => m.t === 'room' && m.room.hostId === guest.id, 8000);
check(newHost.room.hostId === guest.id, 'ホストが抜けたら別の人に交代する');
check(newHost.room.players.every((p) => !p.cpu), 'ホストが動かしていた CPU も退場する');

// ---------- 8. カジュアルマッチ ----------
console.log('■ カジュアルマッチ');
const a = await connect('あ');
const b = await connect('い');
a.send({ t: 'casual', name: 'あ', char: 'moco' });
const q1 = await a.next((m) => m.t === 'queue');
check(q1.waiting === 1, '待機列に入ると人数が返る');
b.send({ t: 'casual', name: 'い', char: 'pepe' });
await b.next((m) => m.t === 'queue');
console.log('  （自動マッチングの待機は最大 15 秒）');
const [ma, mb] = await Promise.all([a.next((m) => m.t === 'start', 30000), b.next((m) => m.t === 'start', 30000)]);
check(ma.seed === mb.seed, '待機列から自動でレースが始まり、同じシードを共有する');
check(ma.players.length === 8, 'カジュアルマッチも CPU で 8 人になる');

for (const c of [guest, spec, a, b]) c.close();
await new Promise((r) => setTimeout(r, 300));

console.log(failures === 0 ? '\n✅ Cloudflare Worker 版サーバーは Node 版と同じ動作' : `\n❌ ${failures} 件の問題`);
process.exit(failures ? 1 : 0);
