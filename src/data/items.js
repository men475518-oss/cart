// アイテム定義。weights: [1位のとき, 中位のとき, 最下位のとき] の重み
export const ITEMS = {
  banana: { id: 'banana', name: 'バナナ', icon: '🍌', color: '#ffe066', desc: '後ろに落とす。踏むとスピン', weights: [30, 14, 2] },
  greenShell: { id: 'greenShell', name: '緑のこうら', icon: '🐢', color: '#7bd389', desc: 'まっすぐ飛び、壁で跳ね返る', weights: [25, 18, 4] },
  redShell: { id: 'redShell', name: '赤のこうら', icon: '🎯', color: '#ff6b6b', desc: '前のプレイヤーを追尾する', weights: [3, 20, 10] },
  mushroom: { id: 'mushroom', name: 'キノコ', icon: '🍄', color: '#ff8fa3', desc: '短時間の加速', weights: [6, 18, 12] },
  tripleMushroom: { id: 'tripleMushroom', name: 'トリプルキノコ', icon: '🍄', badge: '×3', color: '#ff8fa3', desc: 'キノコを3回使える', weights: [0, 8, 20], uses: 3 },
  star: { id: 'star', name: 'スター', icon: '⭐', color: '#ffd23f', desc: 'しばらく無敵＋加速', weights: [0, 3, 14] },
  lightning: { id: 'lightning', name: 'いなずま', icon: '⚡', color: '#c8b6ff', desc: '自分以外を小さくして減速', weights: [0, 1, 9] },
  bomb: { id: 'bomb', name: 'ボム', icon: '💣', color: '#8d99ae', desc: '前に投げて爆発', weights: [5, 10, 5] },
  boomerang: { id: 'boomerang', name: 'ブーメラン', icon: '🪃', color: '#f4a261', desc: '投げると戻ってくる', weights: [8, 10, 5] },
  superHorn: { id: 'superHorn', name: 'スーパーホーン', icon: '📯', color: '#4cc9f0', desc: '周りの追尾アイテムを破壊＋弾き飛ばす', weights: [14, 5, 3] },
  goldenMushroom: { id: 'goldenMushroom', name: 'ゴールデンキノコ', icon: '🍄', badge: '★', color: '#ffb703', desc: '一定時間キノコを連続で使える', weights: [0, 2, 12] },
};

export const ITEM_IDS = Object.keys(ITEMS);

/**
 * 順位に応じたアイテム抽選テーブルを作る
 * @param rankFrac 0 = 1位, 1 = 最下位
 */
export function itemWeightsForRank(rankFrac, luckBonus = 1) {
  const entries = [];
  for (const id of ITEM_IDS) {
    const [a, b, c] = ITEMS[id].weights;
    let w;
    if (rankFrac <= 0.5) w = a + (b - a) * (rankFrac / 0.5);
    else w = b + (c - b) * ((rankFrac - 0.5) / 0.5);
    // 強力アイテム（最下位向け）に「運の良さ」ボーナスを掛ける
    if (c > b && luckBonus !== 1) w *= luckBonus;
    if (w > 0) entries.push({ v: id, w });
  }
  return entries;
}
