/**
 * 威胁驱动的着法生成：按“必杀 → 必挡 → 活四 → 双威胁 → 常规候选”收窄分支。
 * 分支收窄是五子棋能搜深的前提——旧实现每个节点要跑 2~3 次全盘强制手扫描
 * （每次都是"每个棋子周围 25 格 × threatLevel"），开销比真正搜索还大。
 * 着法写入共享着法池 movePool，返回个数；调用方负责在递归返回后回收 movePoolPtr。
 * @returns {number} 着法个数（着法为落点一维下标）
 */
function generateMoves(color) {
  const start = movePoolPtr;
  const opp = color === BLACK ? WHITE : BLACK;
  const sMe = color - 1, sOpp = opp - 1;
  const n = boardSize * boardSize;
  // ① 自己能一手成五 → 只需搜这些点（必胜，取任意一个）
  if (fiveCnt[color] > 0) {
    const f = cgFive[sMe];
    for (let i = 0; i < n && movePoolPtr - start < MAX_MOVES_PER_NODE; i++) if (f[i]) movePool[movePoolPtr++] = i;
    return movePoolPtr - start;
  }
  // ② 对方能一手成五 → 必须堵（自己已无一步成五）
  if (fiveCnt[opp] > 0) {
    const f = cgFive[sOpp];
    for (let i = 0; i < n && movePoolPtr - start < MAX_MOVES_PER_NODE; i++) if (f[i]) movePool[movePoolPtr++] = i;
    return movePoolPtr - start;
  }
  const lvMe = cgLv[sMe], lvOpp = cgLv[sOpp], thrMe = cgThr[sMe];
  // ③ 己方活四/成五点：一手锁定胜局
  for (let i = 0; i < n; i++) if (lvMe[i] >= 3) movePool[movePoolPtr++] = i;
  if (movePoolPtr > start) return movePoolPtr - start;
  // ④ 对方活四点：必须化解（占点或抢先做冲四/活四）
  for (let i = 0; i < n; i++) if (lvOpp[i] >= 3) movePool[movePoolPtr++] = i;
  if (movePoolPtr > start) return movePoolPtr - start;
  // ⑤ 己方双威胁点（一手两个活三以上）：对方一手堵不完，是最强的慢杀起手
  for (let i = 0; i < n; i++) if (thrMe[i] >= 2) movePool[movePoolPtr++] = i;
  if (movePoolPtr > start) return movePoolPtr - start;
  // ⑥ 常规候选（启发式排序后取前 CANDIDATE_LIMIT）
  const cnt = fillCandidateMoves(movePool, start, CANDIDATE_LIMIT, color);
  movePoolPtr = start + cnt;
  return cnt;
}

/** 着法排序分：杀手手优先，其次历史启发 */
function moveOrderScore(idx, hist, kl) {
  if (idx === kl[0]) return 1e15;
  if (idx === kl[1]) return 1e14;
  return hist[idx];
}

/** 对刚生成的着法做稳定插入排序（杀手手 → 历史启发 → 原启发式顺序） */
function orderMoves(start, cnt, color, ply) {
  const hist = historyTable[color - 1];
  const kl = killerTable[ply < 64 ? ply : 63];
  for (let i = 1; i < cnt; i++) {
    const idx = movePool[start + i];
    const s = moveOrderScore(idx, hist, kl);
    let j = i - 1;
    while (j >= 0 && moveOrderScore(movePool[start + j], hist, kl) < s) {
      movePool[start + j + 1] = movePool[start + j];
      j--;
    }
    movePool[start + j + 1] = idx;
  }
}

/** 记录杀手手（同一层引发剪枝的着法） */
function recordKiller(ply, idx) {
  const kl = killerTable[ply < 64 ? ply : 63];
  if (kl[0] !== idx) { kl[1] = kl[0]; kl[0] = idx; }
}

/**
 * 静止搜索（quiescence）：叶节点只延展"冲四级以上"的强制手（以及必须的挡点）。
 * 这是本轮改造能否"让搜索接管战术阶梯"的关键——旧阶梯能看见的双三/VCF 慢杀，
 * 只有靠强制手延展才能在静态评估之前被搜索看见（P0-2 曾因缺少这一环而 0:40 惨败）。
 */
function quiesce(alpha, beta, color, ply, qdepth) {
  searchNodes++;
  if ((searchNodes & 1023) === 0 && performance.now() > searchDeadline) searchAborted = true;
  if (searchAborted) return 0;
  const opp = color === BLACK ? WHITE : BLACK;
  if (fiveCnt[color] > 0) return WIN_SCORE - ply;      // 该方下一手成五
  const stand = evaluateBoard(color, opp, 1, color);   // stand-pat：不再强制手时的静态分
  if (qdepth <= 0) return stand;
  const sMe = color - 1, sOpp = opp - 1;
  const n = boardSize * boardSize;
  const mustBlock = fiveCnt[opp] > 0;
  const start = movePoolPtr;
  if (mustBlock) {
    const f = cgFive[sOpp];
    for (let i = 0; i < n && movePoolPtr - start < MAX_MOVES_PER_NODE; i++) if (f[i]) movePool[movePoolPtr++] = i;
  } else {
    const lvMe = cgLv[sMe];
    for (let i = 0; i < n && movePoolPtr - start < MAX_MOVES_PER_NODE; i++) if (lvMe[i] >= 2) movePool[movePoolPtr++] = i;
  }
  const cnt = movePoolPtr - start;
  if (cnt === 0) { movePoolPtr = start; return stand; }
  let best = mustBlock ? -INF_SCORE : stand;           // 必须堵时不允许 stand-pat
  for (let k = 0; k < cnt; k++) {
    const idx = movePool[start + k];
    const r = (idx / boardSize) | 0, c = idx - r * boardSize;
    const isWin = cgFive[sMe][idx] !== 0;
    enterMove(r, c, color);
    const v = isWin ? WIN_SCORE - ply : -quiesce(-beta, -alpha, opp, ply + 1, qdepth - 1);
    leaveMove(r, c, color);
    if (searchAborted) { movePoolPtr = start; return 0; }
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  movePoolPtr = start;
  return best;
}

/**
 * Negamax + Alpha-Beta + PVS + 置换表 + 杀手/历史启发，分值一律"以当前行动方为视角"。
 * 必胜/必败用 WIN_SCORE - ply 表示（越早赢越好、越晚输越好）——旧实现不管多少步后
 * 取胜都返回同一个 WIN_SCORE，导致"该收杀时不收、该拖时不拖"。
 */
function negamax(depth, alpha, beta, color, ply) {
  searchNodes++;
  if ((searchNodes & 1023) === 0 && performance.now() > searchDeadline) searchAborted = true;
  if (searchAborted) return 0;
  const opp = color === BLACK ? WHITE : BLACK;
  const key = ttKeyOf(color);
  const e = ttMap.get(key);
  if (e !== undefined && e.d >= depth) {
    if (e.f === TT_EXACT) return e.v;
    if (e.f === TT_LOWER && e.v >= beta) return e.v;
    if (e.f === TT_UPPER && e.v <= alpha) return e.v;
  }
  if (fiveCnt[color] > 0) return WIN_SCORE - ply;      // 该方下一手成五
  if (depth <= 0) return quiesce(alpha, beta, color, ply, QUIESCE_MAX_PLIES);
  const alphaOrig = alpha;
  const start = movePoolPtr;
  const cnt = generateMoves(color);
  if (cnt === 0) { movePoolPtr = start; return evaluateBoard(color, opp, 1, color); }
  orderMoves(start, cnt, color, ply);
  let best = -INF_SCORE;
  let bestMove = -1;
  for (let k = 0; k < cnt; k++) {
    const idx = movePool[start + k];
    const r = (idx / boardSize) | 0, c = idx - r * boardSize;
    const isWin = cgFive[color - 1][idx] !== 0;
    enterMove(r, c, color);
    let v;
    if (isWin) {
      v = WIN_SCORE - ply;
    } else if (k === 0) {
      v = -negamax(depth - 1, -beta, -alpha, opp, ply + 1);
    } else {
      // PVS：先用零宽窗口试探，只有落在窗口内才重新全窗口搜索
      v = -negamax(depth - 1, -alpha - 1, -alpha, opp, ply + 1);
      if (v > alpha && v < beta && !searchAborted) v = -negamax(depth - 1, -beta, -alpha, opp, ply + 1);
    }
    leaveMove(r, c, color);
    if (searchAborted) { movePoolPtr = start; return 0; }
    if (v > best) { best = v; bestMove = idx; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (bestMove >= 0) {
        recordKiller(ply, bestMove);
        historyTable[color - 1][bestMove] += depth * depth;
      }
      break;
    }
  }
  movePoolPtr = start;
  ttStore(key, depth, best <= alphaOrig ? TT_UPPER : (best >= beta ? TT_LOWER : TT_EXACT), best);
  return best;
}

/**
 * Alpha-Beta 搜索（保留旧签名与"以 me 为正"的分值口径，供外部工具/测试继续调用）。
 * 内部实现已换成 Negamax + PVS + 静止搜索，见 negamax/quiesce。
 */
function minimax(depth, alpha, beta, isMax, me = aiColor, opp = playerColor) {
  const color = isMax ? me : opp;
  const v = negamax(depth, alpha, beta, color, 0);
  return isMax ? v : -v;
}

/** 该颜色是否存在 level 级以上的威胁点（O(棋盘格数)，仅用于根节点的"别送招"校验） */
function maxLevelExists(color, lv) {
  const a = cgLv[color - 1];
  for (let i = 0; i < a.length; i++) if (a[i] >= lv) return true;
  return false;
}

/**
 * “不送招”校验：这一步会不会凭空送给对方成五点/活四点。
 * 深层搜索偶尔会为了抢攻而漏防，这里是针对最致命失误的廉价保险。
 */
function moveIsSafe(idx, me, opp) {
  if (cgFive[me - 1][idx]) return true;            // 自己一手成五
  if (cgLv[me - 1][idx] >= 3) return true;         // 自己成活四，对方一手挡不住
  const beforeFive = fiveCnt[opp] > 0;
  const beforeL4 = !beforeFive && maxLevelExists(opp, 3);
  const r = (idx / boardSize) | 0, c = idx - r * boardSize;
  enterMove(r, c, me);
  const afterFive = fiveCnt[opp] > 0;
  const afterL4 = !afterFive && maxLevelExists(opp, 3);
  leaveMove(r, c, me);
  if (afterFive && !beforeFive) return false;
  if (afterL4 && !beforeL4) return false;
  return true;
}

/**
 * 根候选：常规启发式候选 + 双方战术点（保证必挡点不会被候选宽度截断），
 * 再过滤掉"会立刻送对手五连/活四"的着法（除非全部都不安全）。
 * @returns {Array<number>} 落点一维下标
 */
function collectRootMoves(me, opp) {
  if (!evalReady) ensureEvalState();
  const n = boardSize * boardSize;
  const lvMe = cgLv[me - 1], lvOpp = cgLv[opp - 1];
  const seen = new Uint8Array(n);
  const res = [];
  const push = (i) => {
    if (i < 0 || i >= n || seen[i]) return;
    const r = (i / boardSize) | 0;
    if (board[r][i - r * boardSize] !== EMPTY) return;
    seen[i] = 1;
    res.push(i);
  };
  for (let i = 0; i < n; i++) if (lvMe[i] >= 2) push(i);    // 己方冲四以上
  for (let i = 0; i < n; i++) if (lvOpp[i] >= 2) push(i);   // 对方冲四以上（必挡点）
  if (!candScratch || candScratch.length < ROOT_CANDIDATE_LIMIT) candScratch = new Int32Array(64);
  const cnt = fillCandidateMoves(candScratch, 0, ROOT_CANDIDATE_LIMIT, me);
  for (let k = 0; k < cnt; k++) push(candScratch[k]);
  const safe = [];
  for (let k = 0; k < res.length; k++) if (moveIsSafe(res[k], me, opp)) safe.push(res[k]);
  return safe.length ? safe : res;
}

/**
 * 困难档决策：只保留“可证明”的短路（一步成五 / 必挡五 / 己方 VCF 连杀 /
 * 对方 VCF 必堵 / 对方 VCT 必堵），其余全部交给 8~12 层深搜裁决。
 *
 * 旧实现把 11 级单步战术阶梯放在搜索之前短路返回，导致 83% 的着法根本不经搜索、
 * 参数旋钮全部失效（见仓库历史：12 项参数级改动全部持平）。本轮把阶梯降级为
 * “候选注入 + 排序提示”（由 collectRootMoves 保证必挡点进候选），决策权交还搜索。
 */
function hardMove(me, opp) {
  const win = findImmediateWin(me);
  if (win) return win;
  const block = findImmediateWin(opp);
  if (block) return block;
  const vcf = findVcfWin(me, VCF_MAX_PLIES);          // 己方连续冲四杀：已证明的强制胜
  if (vcf) return vcf;
  if (findVcfWin(opp, VCF_MAX_PLIES)) {               // 对方连续冲四杀：必须先堵
    const t = resolveThreats(me, opp, true);
    if (t) return t;
  }
  const oppVct = findVctWin(opp);                     // 对方活三链杀：搜索深度不足以覆盖，单独挡
  lastVctPath = null;                                 // 对方杀棋路径只用于决策，不作为教学展示
  if (oppVct) {
    const d = vctDefense(opp);
    if (d) return d;
  }
  // 开局阶段（≤ OPENING_BOOK_MAX_STONES 子）仍走开局库/定式：库是深度 3 自对弈生成的，
  // 只在开局有参考价值，中盘以后一律交给搜索。
  if (pieceCount <= OPENING_BOOK_MAX_STONES) {
    const book = bookMove(LEVEL_HARD, me);
    if (book) return book;
    if (me === aiColor) {
      const o = openingMove(LEVEL_HARD);
      if (o) return o;
    }
  }
  const m = bestBySearch(me, opp, LEVEL_HARD);
  return m || bestByScore(me, opp, LEVEL_HARD);
}
