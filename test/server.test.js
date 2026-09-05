import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { listen, close } from '../server/index.js';

let port;
const server = await listen(0);
port = server.address().port;
after(() => close());

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const inbox = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const w = waiters.findIndex((x) => x.pred(msg));
      if (w >= 0) waiters.splice(w, 1)[0].resolve(msg);
      else inbox.push(msg);
    });
    ws.on('error', reject);
    const client = {
      ws,
      id: null,
      send: (o) => ws.send(JSON.stringify(o)),
      next: (pred, ms = 4000) =>
        new Promise((res, rej) => {
          const i = inbox.findIndex(pred);
          if (i >= 0) return res(inbox.splice(i, 1)[0]);
          const waiter = { pred, resolve: (m) => { clearTimeout(timer); res(m); } };
          const timer = setTimeout(() => {
            const wi = waiters.indexOf(waiter);
            if (wi >= 0) waiters.splice(wi, 1); // タイムアウトした待ち受けは外す
            rej(new Error('timeout waiting for message'));
          }, ms);
          waiters.push(waiter);
        }),
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

test('private room: create, join, ready, start with CPUs, relay state, finish → results', async () => {
  const host = await connect('ホスト');
  const guest = await connect('ゲスト');
  host.send({ t: 'create', name: 'ホスト', char: 'taro', kart: { color: 'red' } });
  const created = await host.next((m) => m.t === 'room');
  assert.equal(created.room.code.length, 4);
  assert.equal(created.room.hostId, host.id);
  guest.send({ t: 'join', code: created.room.code, name: 'ゲスト', char: 'don' });
  const joined = await guest.next((m) => m.t === 'room' && m.room.players.length === 2);
  assert.equal(joined.room.players.length, 2);
  await host.next((m) => m.t === 'room' && m.room.players.length === 2);
  guest.send({ t: 'ready', ready: true });
  const readyView = await host.next((m) => m.t === 'room' && m.room.players.find((p) => p.id === guest.id)?.ready);
  assert.ok(readyView);
  // ゲストは start できない
  guest.send({ t: 'start', course: 'city', cpuCount: 8 });
  await assert.rejects(guest.next((m) => m.t === 'start', 500));
  host.send({ t: 'start', course: 'city', laps: 2, cpuCount: 8 });
  const [sh, sg] = await Promise.all([host.next((m) => m.t === 'start'), guest.next((m) => m.t === 'start')]);
  assert.equal(sh.course, 'city');
  assert.equal(sh.laps, 2);
  assert.equal(sh.players.length, 8);
  assert.equal(sh.players.filter((p) => p.cpu).length, 6);
  assert.equal(sh.seed, sg.seed);
  // 状態リレー: ホストは CPU の状態も送れる、ゲストは自分の分だけ
  const cpuId = sh.players.find((p) => p.cpu).id;
  host.send({ t: 'state', id: cpuId, s: { x: 1, z: 2, h: 0, v: 10, tp: 5 } });
  const relayed = await guest.next((m) => m.t === 'state' && m.id === cpuId);
  assert.equal(relayed.s.tp, 5);
  guest.send({ t: 'state', id: cpuId, s: { x: 9 } }); // 不正: ゲストが CPU を名乗る
  await assert.rejects(host.next((m) => m.t === 'state' && m.id === cpuId, 400));
  guest.send({ t: 'state', id: guest.id, s: { x: 3, z: 4, h: 0, v: 20, tp: 7 } });
  const gs = await host.next((m) => m.t === 'state' && m.id === guest.id);
  assert.equal(gs.s.x, 3);
  // イベントリレー
  host.send({ t: 'event', e: { k: 'spawn', desc: { id: 'h1', type: 'banana', x: 0, z: 0, heading: 0, ownerId: host.id } } });
  const ev = await guest.next((m) => m.t === 'event' && m.e.k === 'spawn');
  assert.equal(ev.id, host.id);
  // ゴール: 人間 2 人 + CPU 6 がゴール → results
  host.send({ t: 'event', e: { k: 'finish', id: host.id, time: 61.5 } });
  guest.send({ t: 'event', e: { k: 'finish', id: guest.id, time: 60.2 } });
  for (const p of sh.players.filter((p) => p.cpu)) host.send({ t: 'event', e: { k: 'finish', id: p.id, time: 70 + Math.random() } });
  const res = await host.next((m) => m.t === 'results');
  assert.equal(res.results.length, 8);
  assert.equal(res.results[0].id, guest.id);
  assert.equal(res.results[0].rank, 1);
  assert.equal(res.results[1].id, host.id);
  const back = await host.next((m) => m.t === 'room' && m.room.status === 'lobby');
  assert.equal(back.room.status, 'lobby');
  host.close();
  guest.close();
});

test('spectator receives start and unknown room code errors out', async () => {
  const host = await connect('h');
  host.send({ t: 'create', name: 'h', char: 'pyon' });
  const created = await host.next((m) => m.t === 'room');
  const spec = await connect('s');
  spec.send({ t: 'spectate', code: 'ZZZZ' });
  const err = await spec.next((m) => m.t === 'error');
  assert.equal(err.code, 'notfound');
  spec.send({ t: 'spectate', code: created.room.code });
  const view = await spec.next((m) => m.t === 'room' && m.spectating);
  assert.ok(view.spectating);
  host.send({ t: 'start', course: 'beach', cpuCount: 3 });
  const st = await spec.next((m) => m.t === 'start');
  assert.equal(st.players.length, 4);
  host.close();
  spec.close();
});

test('casual queue reports waiting status', async () => {
  const a = await connect('a');
  a.send({ t: 'casual', name: 'a', char: 'moco' });
  const q = await a.next((m) => m.t === 'queue');
  assert.equal(q.waiting, 1);
  a.send({ t: 'leave' });
  a.close();
});
