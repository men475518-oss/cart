// タイムアタックの記録。コースごとのベストタイムとベストラップを残す。
const KEY = 'mofukart.records.v1';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    /* 保存できない環境（プライベートモードなど）でも遊べるようにする */
  }
}

/** そのコース・周回数の記録 { total, lap, char, at } */
export function getRecord(courseId, laps) {
  return load()[`${courseId}:${laps}`] || null;
}

/**
 * 記録を更新する。速くなったところだけ書きかえる。
 * @returns { totalBest, lapBest } どちらを更新したか
 */
export function submitRecord(courseId, laps, { total, lap, char }) {
  const data = load();
  const key = `${courseId}:${laps}`;
  const cur = data[key] || {};
  const totalBest = total != null && (cur.total == null || total < cur.total);
  const lapBest = lap != null && (cur.lap == null || lap < cur.lap);
  if (!totalBest && !lapBest) return { totalBest: false, lapBest: false };
  data[key] = {
    total: totalBest ? total : cur.total,
    lap: lapBest ? lap : cur.lap,
    char: char || cur.char || null,
    at: Date.now(),
  };
  save(data);
  return { totalBest, lapBest };
}

/** すべての記録（設定のリセット用） */
export function clearRecords() {
  save({});
}
