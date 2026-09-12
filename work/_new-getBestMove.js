/**
 * 难度分层的决策入口。
 *
 * 困难档（harness 基准与"练棋"场景）：只保留三条**可证明**的安全短路——
 *   自己能一步成五 / 对方能一步成五 / 对方存在 VCF(连续冲四)或 VCT(活三链)杀，
 * 其余全部交给 8~12 层负极大搜索 + 静止搜索裁决（见 hardMove）。
 * 改造理由（仓库实测结论）：旧实现把 11 级单步战术阶梯放在搜索之前短路返回，
 * 一整局 30 手里只有 17% 的着法真正进入搜索，因此 12 项参数级改动（分值表、
 * 窗口评估、候选注入、加深搜索、6 个参数）全部无法提升棋力；而直接把阶梯换成
 * 搜索又因深度不足（3 层）惨败 0:40。正确的顺序是"先把评估/威胁检测做成增量、
 * 让搜索有能力看穿双三与 VCF/VCT 慢杀，再把决策权交还搜索"——即本轮改造。
 *
 * 中等档：保持"单步战术分层 + 浅搜索"的原有行为（面向新手：响应快、战术不漏），
 * 但底层评估与威胁检测已换成增量实现，同样的预算能搜得更深。
 * @param {string} level 难度（easy/medium/hard）
 * @param {number} [forColor] 决策视角颜色（默认 aiColor；教学推荐玩家时传 playerColor）
 * @returns {Array|null} [r, c]
 */
function getBestMove(level, forColor) {
  const me = forColor || aiColor;
  const opp = me === BLACK ? WHITE : BLACK;

  if (level === LEVEL_EASY) {
    // 简单档保持“入门”定位：不做复杂威胁分层，但最基本的“能赢就赢、
    // 对方要赢了必须挡”不能漏，否则 AI 会犯低级失误、体验很差。
    const easyWin = findImmediateWin(me);
    if (easyWin) return easyWin;
    const easyBlock = findImmediateWin(opp);
    if (easyBlock) return easyBlock;
    return bestByScore(me, opp, level);
  }

  // 困难档：安全短路 + 深搜（决策权交还搜索）
  if (level === LEVEL_HARD) return hardMove(me, opp);

  // 中等档：完整威胁分层（一步成五 → VCF → 双杀 → 活四/活三攻防 → 开局库 → 启发式开局 → 浅搜索）
  {
    const aiWin = findImmediateWin(me);            // 自己能一步成五 → 直接赢
    if (aiWin) return aiWin;
    const playerWin = findImmediateWin(opp);       // 对方能一步成五 → 必须挡
    if (playerWin) return playerWin;
    // VCF 连续冲四杀棋：自己能连杀先走，对方能连杀必须先堵
    const vcfWin = findVcfWin(me, VCF_MAX_PLIES);
    if (vcfWin) return vcfWin;
    if (findVcfWin(opp, VCF_MAX_PLIES)) {
      const threat = resolveThreats(me, opp, true); // 堵对方当前的冲四/活四端点
      if (threat) return threat;
    }
    // 双杀：一手形成双四/活四等不可防威胁
    const dt = findDoubleThreat(me);
    if (dt) return dt;
    // 紧急攻防：己方活四 / 对方活四（不含己方活三与“眠三开放端”，先处理真正致命的杀招）
    const urgent = resolveThreats(me, opp, true, false);
    if (urgent) return urgent;
    // 双三/三四/双四“阵法杀招”：一手形成双威胁且对方无更快威胁 → 主动建立必胜阵型
    const dk = findDoubleKill(me);
    if (dk) return dk;
    // VCT 活三链杀：用“连续活三/双三”逼对方防守，直到把优势走成活四/五连。
    const vctWin = findVctWin(me);
    if (vctWin) return vctWin;
    // 对方存在活三链杀 → 必须先堵对方活三/冲四的开放端点。
    const oppVct = findVctWin(opp);
    lastVctPath = null;
    if (oppVct) {
      const vctDef = vctDefense(opp);
      if (vctDef) return vctDef;
    }
    // 对方双杀意图防守：对方下一步一手可成双三/三四/双四 → 抢先堵住关键点
    const oppDt = findOpponentDoubleThreat(opp);
    if (oppDt) return oppDt;
    // 常规攻防：己方活三（进攻优先）与防守反击选点
    const threat = resolveThreats(me, opp, false, false);
    if (threat) return threat;
    // 开局库（盘面 ≤8 子）
    const book = bookMove(level, me);
    if (book) return book;
    // 启发式开局策略（0~8 子兜底）
    if (me === aiColor) {
      const o = openingMove(level);
      if (o) return o;
    }
  }
  // 中等档：在威胁分层之上叠加浅搜索（预算内已由增量评估提速，同样时间看得更深）
  return bestBySearch(me, opp, level, MEDIUM_SEARCH_BUDGET_MS, MEDIUM_SEARCH_DEPTH);
}
