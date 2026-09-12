/**
 * 收集 color 一步即可形成“冲四级以上威胁”（minLv=2 冲四 / minLv=3 活四 / 成五）的空位。
 * 强度改造：直接读增量表的 cgLv（O(棋盘格数) 次数组读取），
 * 旧实现要对每个同色棋子周围 25 格逐个跑 threatLevel（4 次 lineInfo）。
 * @param {number} color 行动方颜色
 * @param {number} [minLv] 最低威胁等级（默认 2）
 * @returns {Array<Array<number>>} [r, c] 列表（按行优先顺序，确定性）
 */
function forcingMovesOf(color, minLv = 2) {
  if (!evalReady) ensureEvalState();
  const lv = cgLv[color - 1];
  const pts = [];
  for (let r = 0; r < boardSize; r++) {
    const base = r * boardSize;
    for (let c = 0; c < boardSize; c++) if (lv[base + c] >= minLv) pts.push([r, c]);
  }
  return pts;
}
