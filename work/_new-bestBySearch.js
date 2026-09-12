/**
 * 困难档搜索入口：迭代加深 + Negamax/Alpha-Beta/PVS + 静止搜索。
 * 时间管理：每层开始前预测"下一层是否放得下"（用本层耗时的 3 倍估算），
 * 放不下就停；层内超预算则采用已完成部分中"优于上一层结果"的着法。
 * 这样既不会"等满预算却只拿到浅层结果"，也不会在小局面白白空转。
 * @param {string} [level] 当前难度，仅用于兜底打分时的随机候选数
 * @param {number} [budgetMs] 单步时间预算
 * @param {number} [depthLimit] 深度上限（>0 时覆盖 searchDepth，中等档固定浅搜用）
 * @returns {Array|null} [r, c]
 */
function bestBySearch(me = aiColor, opp = playerColor, level, budgetMs = SEARCH_BUDGET_MS, depthLimit = 0) {
  // 重建棋盘哈希、开新一代置换表、对齐增量评估状态（ttMap 跨步复用，见 initSearchTables）
  initSearchTables();
  // 根节点先做必杀检测（能赢立刻赢、该挡立刻挡）
  const aiWin = findImmediateWin(me);
  if (aiWin) return aiWin;
  const playerWin = findImmediateWin(opp);
  if (playerWin) return playerWin;

  const budget = budgetMs > 0 ? budgetMs : SEARCH_BUDGET_MS;
  searchDeadline = performance.now() + budget;
  searchAborted = false;
  searchNodes = 0;

  const maxDepth = depthLimit > 0 ? Math.min(depthLimit, searchDepth()) : searchDepth();
  let ordered = collectRootMoves(me, opp);
  if (ordered.length === 0) return bestByScore(me, opp, level);

  let bestMove = -1;
  let bestScore = -INF_SCORE;
  for (let depth = Math.min(2, maxDepth); depth <= maxDepth; depth++) {
    const itStart = performance.now();
    let alpha = -INF_SCORE;
    const beta = INF_SCORE;
    const scored = [];
    let dBest = -1, dScore = -INF_SCORE;
    for (let k = 0; k < ordered.length; k++) {
      const idx = ordered[k];
      const r = (idx / boardSize) | 0, c = idx - r * boardSize;
      const isWin = cgFive[me - 1][idx] !== 0;
      enterMove(r, c, me);
      const v = isWin ? WIN_SCORE - 1 : -negamax(depth - 1, -beta, -alpha, opp, 1);
      leaveMove(r, c, me);
      if (searchAborted) break;
      scored.push([idx, v]);
      if (v > dScore) { dScore = v; dBest = idx; }
      if (v > alpha) alpha = v;
    }
    // 本层跑完 → 全部可信；只跑了一部分 → 仅当出现了"比上一层更好"的着法才采用
    if (dBest >= 0 && (scored.length === ordered.length || dScore > bestScore)) {
      bestMove = dBest;
      bestScore = dScore;
    }
    if (bestScore >= WIN_SCORE - 1000) break;          // 已找到必胜手，立刻收手
    if (scored.length < ordered.length) break;         // 本层被预算打断：采用已有结果
    scored.sort((a, b) => b[1] - a[1]);                // 下一层优先试好手，剪枝更早
    ordered = scored.map((s) => s[0]);
    const itTime = performance.now() - itStart;
    if (performance.now() + itTime * 3 > searchDeadline) break;
  }
  if (bestMove < 0) return bestByScore(me, opp, level);
  return [(bestMove / boardSize) | 0, bestMove % boardSize];
}
