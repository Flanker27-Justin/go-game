/**
 * 把常规候选（启发式前 limit 名）按分数降序写入 out[start...)，返回写入个数。
 * 强度改造：不再用 Set 去重扫描“棋子周围 HINT_RADIUS 格”，改为 near2 计数过滤
 * （切比雪夫距离 ≤2 内有子的空位，与旧口径完全一致）；评分全部读增量表，O(1)。
 * 采用插入式 top-K：不做整表排序、不产生临时数组（深搜热点，每节点都会调用）。
 */
function fillCandidateMoves(out, start, limit, color) {
  const me = color || aiColor;
  const opp = me === BLACK ? WHITE : BLACK;
  const sMe = me - 1, sOpp = opp - 1;
  const lvMe = cgLv[sMe], thrMe = cgThr[sMe];
  const sumMe = cgSum[sMe], sumOpp = cgSum[sOpp];
  const n = boardSize * boardSize;
  if (!scoreScratch || scoreScratch.length < limit) scoreScratch = new Float64Array(Math.max(limit, 64));
  const scores = scoreScratch;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (near2[i] === 0) continue;
    const r = (i / boardSize) | 0;
    if (board[r][i - r * boardSize] !== EMPTY) continue;
    const s = scoreOfIdx(i, sumMe, sumOpp, lvMe, thrMe);
    if (cnt === limit && s <= scores[cnt - 1]) continue;
    let p = cnt < limit ? cnt : limit - 1;
    while (p > 0 && scores[p - 1] < s) {
      scores[p] = scores[p - 1];
      out[start + p] = out[start + p - 1];
      p--;
    }
    scores[p] = s;
    out[start + p] = i;
    if (cnt < limit) cnt++;
  }
  return cnt;
}

/** 候选点启发分（与旧 scoreFor + 强制手/双威胁加权完全一致） */
function scoreOfIdx(i, sumMe, sumOpp, lvMe, thrMe) {
  let sm = sumMe[i];
  if (sm >= LIVE_THREE_SCORE * 2) sm *= 2;
  let so = sumOpp[i];
  if (so >= LIVE_THREE_SCORE * 2) so *= 2;
  return sm + so * 0.8 + lvMe[i] * 8000 + (thrMe[i] >= 2 ? 16000 : 0);
}

/**
 * 生成候选落点：只收集“已有棋子周围 HINT_RADIUS 格内”的空位，
 * 再按启发式得分降序取前 limit 个。
 * 理由：远离棋子的落点在开局阶段几乎无意义，裁剪可大幅缩小搜索树。
 * @returns {Array<Array<number>>} [[r, c], ...]（按分数降序）
 */
function getCandidateMoves(limit, color) {
  if (!evalReady) ensureEvalState();
  const lim = limit > 0 ? limit : CANDIDATE_LIMIT;
  if (!candScratch || candScratch.length < lim) candScratch = new Int32Array(Math.max(lim, 64));
  const cnt = fillCandidateMoves(candScratch, 0, lim, color);
  const res = [];
  for (let k = 0; k < cnt; k++) {
    const i = candScratch[k];
    const r = (i / boardSize) | 0;
    res.push([r, i - r * boardSize]);
  }
  return res;
}
