/**
 * 动态搜索深度上限：按盘面棋子数自动加深。
 * 强度改造前的实现是 3/5/6 层——那是被"每节点上千次 lineInfo"的评估成本逼出来的；
 * 增量棋型引擎把叶节点评估从 ~1500 次 lineInfo 降到 O(1) 之后，开局/中盘也能负担
 * 8 层以上。真正的耗时控制由 bestBySearch 的迭代加深 + 时间预算负责（本函数只是上限）。
 * @returns {number} 本次搜索的深度上限
 */
function searchDepth() {
  const placed = pieceCount;
  if (placed >= 60) return 12;   // 残局后期：候选点很少，可放心加深
  if (placed >= 35) return 10;   // 中后盘
  return 8;                      // 开局/中盘
}
