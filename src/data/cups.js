// グランプリ（カップ戦）の定義。
// 何レースか続けて走り、順位に応じたポイントの合計で総合優勝を決める。
export const CUPS = [
  {
    id: 'mushroom',
    name: 'きのこカップ',
    emoji: '🍄',
    desc: 'やさしめの 4 コース。まずはここから',
    difficulty: 2,
    courses: ['meadow', 'beach', 'snow', 'timeloop'],
  },
  {
    id: 'star',
    name: 'スターカップ',
    emoji: '⭐',
    desc: 'むずかしい 4 コース。最終戦は宇宙にかかるレインボーロード',
    difficulty: 5,
    courses: ['volcano', 'city', 'factory', 'rainbow'],
  },
];

// 順位ごとのポイント（8 人ぶん）。マリオカートと同じで 1 位が大きく開く
export const CUP_POINTS = [15, 12, 10, 9, 8, 7, 6, 5];

/** その順位のポイント。人数が 8 人より多いときは最小値 */
export function pointsForRank(rank) {
  return CUP_POINTS[rank - 1] ?? CUP_POINTS[CUP_POINTS.length - 1];
}

export const CUP_BY_ID = Object.fromEntries(CUPS.map((c) => [c.id, c]));
export const getCup = (id) => CUP_BY_ID[id] || CUPS[0];

/** 総合順位。ポイント降順、同点なら「1 位の回数 → 2 位の回数…」の多い方が上 */
export function cupStandings(entries) {
  return [...entries]
    .map((e) => ({ ...e }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const n = Math.max(a.finishes.length, b.finishes.length);
      for (let r = 1; r <= n; r++) {
        const ca = a.finishes.filter((x) => x === r).length;
        const cb = b.finishes.filter((x) => x === r).length;
        if (ca !== cb) return cb - ca;
      }
      return 0;
    })
    .map((e, i) => ({ ...e, rank: i + 1 }));
}
