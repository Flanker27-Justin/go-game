const fs = require('fs');
const p = 'work/fix-parts/part1.txt';
let cur = fs.readFileSync(p, 'utf8');
const blocks = [
  ['  // \uFFFD?玩家最后一步形成的棋型方向：黄色半透明粗线（画在棋子之上，', '  // ① 玩家最后一步形成的棋型方向：黄色半透明粗线（画在棋子之上，'],
  ['  //    直观展示“这步形成了活三/冲四”等棋型走向\uFFFD?  if (lastMove && board[lastMove[0]][lastMove[1]] === playerColor) {', '  //    直观展示“这步形成了活三/冲四”等棋型走向）\n  if (lastMove && board[lastMove[0]][lastMove[1]] === playerColor) {'],
  ['  // \uFFFD?AI 下一步可成五的危险点：红色圆圈，\uFFFD?300ms 节奏闪烁，提醒玩家先防守', '  // ② AI 下一步可成五的危险点：红色圆圈，随 300ms 节奏闪烁，提醒玩家先防守'],
  [' * 说明\uFFFD? * - 简单：纯单步启发式打分\uFFFD? * - 中等：在打分基础上增加“一步必杀/挡杀”检测、VCF 连续冲四杀棋\uFFFD? *         双杀（双\uFFFD?双四）威胁识别、双\uFFFD?双四组合加权、威胁分层决\uFFFD? *         （含“防守反击”选点）、开局库（\uFFFD?5 手查表）与规则式开局策略兜底\uFFFD? * - 困难：再叠加 Alpha-Beta 剪枝搜索，搜索深度随残局进度自动加深\uFFFD?\uFFFD?\uFFFD? 层）\uFFFD? *         单步思考预算最长约 4s，中后盘与残局能看穿更长的杀棋链条\uFFFD? * 统一入口 getBestMove(level, forColor)：AI 落子\uFFFD?aiColor 视角\uFFFD? * 教学推荐\uFFFD?点评\uFFFD?playerColor（玩家）视角，保证建议真正利于玩家\uFFFD? * 猜先功能可让玩家执白、AI 执黑，因此所\uFFFD?AI 决策一律以 aiColor 为准\uFFFD? * ============================================================ */',
    ' * 说明：\n * - 简单：纯单步启发式打分；\n * - 中等：在打分基础上增加“一步必杀/挡杀”检测、VCF 连续冲四杀棋、\n *         双杀（双四/活四）威胁识别、双三/双四组合加权、威胁分层决策\n *         （含“防守反击”选点）、开局库（前 9 手查表）与规则式开局策略兜底；\n * - 困难：再叠加 Alpha-Beta 剪枝搜索，搜索深度随残局进度自动加深（3→5→6 层），\n *         单步思考预算最长约 4s，中后盘与残局能看穿更长的杀棋链条。\n * 统一入口 getBestMove(level, forColor)：AI 落子用 aiColor 视角；\n * 教学推荐点/点评用 playerColor（玩家）视角，保证建议真正利于玩家。\n * 猜先功能可让玩家执白、AI 执黑，因此所有 AI 决策一律以 aiColor 为准。\n * ============================================================ */'],
  [' * VCF（Victory by Continuous Fours，连续冲四）杀棋检测\uFFFD? * 思路：连续下“冲四”，对方每一步都只能被迫挡这个冲四，', ' * VCF（Victory by Continuous Fours，连续冲四）杀棋检测。\n * 思路：连续下“冲四”，对方每一步都只能被迫挡这个冲四，'],
  [' * 一路把对方带到“活\uFFFD?五连”为止——这就是一条强制胜序列\uFFFD? * 命中时返回当前这一步（首个强制落点），并把完整路径存入 lastVcfPath 供教学展示\uFFFD? * @param {number} color 进攻方颜\uFFFD? * @param {number} maxPlies 最大搜索层数（每层 = 己方一\uFFFD?+ 对方一手）', ' * 一路把对方带到“活四/五连”为止——这就是一条强制胜序列。\n * 命中时返回当前这一步（首个强制落点），并把完整路径存入 lastVcfPath 供教学展示。\n * @param {number} color 进攻方颜色\n * @param {number} maxPlies 最大搜索层数（每层 = 己方一手 + 对方一手）'],
  ['  // 对方已可一步成\uFFFD?\uFFFD?VCF 前提不成立（必须先防守）\uFFFD?  // 我方已可一步成\uFFFD?\uFFFD?交给 findImmediateWin 处理即可\uFFFD?  if (findImmediateWin(opp) || findImmediateWin(color)) return null;', '  // 对方已可一步成五 → VCF 前提不成立（必须先防守）；\n  // 我方已可一步成五 → 交给 findImmediateWin 处理即可。\n  if (findImmediateWin(opp) || findImmediateWin(color)) return null;'],
  ['  // 记录“最短连杀路径”：同一局面往往存在多条 VCF 路线，优先走手数最短的\uFFFD?  // 因为对方被迫应的手数越少，越没有机会中途反杀，杀棋越稳\uFFFD?  const vcf = { nodes: 0, t0: performance.now(), budget: VCF_TIME_BUDGET_MS, cur: [], bestLen: Infinity, bestPath: null };', '  // 记录“最短连杀路径”：同一局面往往存在多条 VCF 路线，优先走手数最短的，\n  // 因为对方被迫应的手数越少，越没有机会中途反杀，杀棋越稳。\n  const vcf = { nodes: 0, t0: performance.now(), budget: VCF_TIME_BUDGET_MS, cur: [], bestLen: Infinity, bestPath: null };'],
  [' * VCF 递归主体\uFFFD? * @param {number|null} lastR 上一手落点行（用于快速判五，null 表示根节点）', ' * VCF 递归主体。\n * @param {number|null} lastR 上一手落点行（用于快速判五，null 表示根节点）'],
  [' * @returns {number} 从该节点取胜所需最少“己方手数”（>0 表示必胜\uFFFD?1 表示无解/超限\uFFFD? */', ' * @returns {number} 从该节点取胜所需最少“己方手数”（>0 表示必胜，-1 表示无解/超限） */'],
  ['  if (++vcf.nodes > VCF_NODE_LIMIT) return -1;               // 节点上限防卡\uFFFD?  if (performance.now() - vcf.t0 > vcf.budget) return -1;    // 时间上限防卡\uFFFD?  if (lastR !== null && canWinNow(lastR, lastC, color)) {', '  if (++vcf.nodes > VCF_NODE_LIMIT) return -1;               // 节点上限防卡顿\n  if (performance.now() - vcf.t0 > vcf.budget) return -1;    // 时间上限防卡顿\n  if (lastR !== null && canWinNow(lastR, lastC, color)) {'],
  ['    if (vcf.cur.length < vcf.bestLen) {                      // vcf.cur 即“根到当前手”完整路\uFFFD?      vcf.bestLen = vcf.cur.length;', '    if (vcf.cur.length < vcf.bestLen) {                      // vcf.cur 即“根到当前手”完整路径\n      vcf.bestLen = vcf.cur.length;'],
  ['      len = 1;                              // 直接成五或形成活四：对方无法一手化\uFFFD?      if (vcf.cur.length < vcf.bestLen) {', '      len = 1;                              // 直接成五或形成活四：对方无法一手化解\n      if (vcf.cur.length < vcf.bestLen) {'],
  ['        len = 1;                            // 双四：对方只能堵一处，另一处照样成\uFFFD?        if (vcf.cur.length < vcf.bestLen) {', '        len = 1;                            // 双四：对方只能堵一处，另一处照样成五\n        if (vcf.cur.length < vcf.bestLen) {'],
  ['        if (sub > 0) len = sub + 1;         // 对方堵住后我们仍能连杀，总手\uFFFD?+1', '        if (sub > 0) len = sub + 1;         // 对方堵住后我们仍能连杀，总手数+1'],
  ['    // 只保留手数最短的分支：杀棋越短越稳（vcfForcingMoves 已按威胁等级排序\uFFFD?    if (len > 0 && len < bestLen) { bestLen = len; bestMove = [r, c]; }', '    // 只保留手数最短的分支：杀棋越短越稳（vcfForcingMoves 已按威胁等级排序）\n    if (len > 0 && len < bestLen) { bestLen = len; bestMove = [r, c]; }'],
  ['  // 根节点处把最短路径起点记录下来，\uFFFD?findVcfWin 返回', '  // 根节点处把最短路径起点记录下来，供 findVcfWin 返回'],
  ['/** 收集“落子后能形成冲\uFFFD?活四/五连”的候选点，按威胁等级与启发式分降\uFFFD?*/', '/** 收集“落子后能形成冲四/活四/五连”的候选点，按威胁等级与启发式分降序 */'],
  ['/** 我方\uFFFD?(r, c) 落子形成冲四后，对方必须堵住的开放端点（冲四只有一个端点） */', '/** 我方在 (r, c) 落子形成冲四后，对方必须堵住的开放端点（冲四只有一个端点） */'],
  [' * 双杀检测：一手落子后形成“不可防”的双重威胁（双\uFFFD?/ 活四+任意），', ' * 双杀检测：一手落子后形成“不可防”的双重威胁（双四 / 活四+任意），'],
  [' * 对方一步只能处理其中一处，另一处下一手必然成五\uFFFD? * @returns {Array|null} [r, c]', ' * 对方一步只能处理其中一处，另一处下一手必然成五。\n * @returns {Array|null} [r, c]'],
  ['      let forcing = 0;                        // 冲四/活四方向\uFFFD?      for (const [dr, dc] of DIRECTIONS) {', '      let forcing = 0;                        // 冲四/活四方向数\n      for (const [dr, dc] of DIRECTIONS) {'],
  ['      if (maxLv < 3 && forcing < 2) continue; // 只有活四\uFFFD?）或双冲四（2+2）才算不可防', '      if (maxLv < 3 && forcing < 2) continue; // 只有活四（3）或双冲四（2+2）才算不可防'],
  [' * 双三/双威胁“阵法杀招”检测：一手落子后形成两个“活三以上”威\uFFFD? * （双\uFFFD?/ 活三+冲四 / 双四），对方一步只能堵一处，是五子棋最典型\uFFFD? * 必胜阵型——中盘把握住它就能把优势直接兑现成杀棋\uFFFD? * 前提：对方没有更快威胁（不能一步成五、也不能一手成活四），', ' * 双三/双威胁“阵法杀招”检测：一手落子后形成两个“活三以上”威胁\n * （双三/活三+冲四/双四），对方一步只能堵一处，是五子棋最典型的\n * 必胜阵型——中盘把握住它就能把优势直接兑现成杀棋。\n * 前提：对方没有更快威胁（不能一步成五、也不能一手成活四），'],
  [' * 否则必须先防守，双杀只是空谈\uFFFD? * @param {number} color 行动方颜\uFFFD? * @returns {Array|null} 杀招落\uFFFD?[r, c]；不存在则返\uFFFD?null', ' * 否则必须先防守，双杀只是空谈。\n * @param {number} color 行动方颜色\n * @returns {Array|null} 杀招落点 [r, c]；不存在则返回 null'],
];
for (const [o, n] of blocks) {
  cur += '=====OLD-BLOCK=====\n' + o + '\n=====NEW-BLOCK=====\n' + n + '\n=====END-BLOCK=====\n';
}
fs.writeFileSync(p, cur, 'utf8');
console.log('total blocks:', (cur.match(/=====OLD-BLOCK=====/g) || []).length);
