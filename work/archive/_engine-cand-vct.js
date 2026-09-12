/* ============================================================
 * 五子棋 AI 引擎（独立模块，零依赖）
 * ------------------------------------------------------------
 * 这是五子棋 AI 的唯一权威实现：页面（gomoku.html）与全部测试都从这里加载，
 * 不允许存在第二份实现。本文件由 work/build-engine.js 生成——
 * 它把下方“引擎实现”段里的函数逐字保留、重新编排结构与导出清单。
 *
 * 对外接口（浏览器全局 GomokuAI / Node module.exports）：
 *   board             引擎持有的棋盘二维数组（唯一数据源，游戏侧直接读写）
 *   setBoardSize(n)   重建 n×n 棋盘（清空并重置搜索缓存）——开新局用
 *   resizeBoard(n)    只改尺寸并重建棋盘——重连恢复等场景由调用方自行写盘
 *   setColors(me,opp) 设定玩家/AI 执子颜色（AI 决策视角依赖它）
 *   setMoveVariety(v) 出棋随机度：0=完全确定（测试/基准），1=正常
 *   getBestMove(level, forColor) 取最佳落点
 *   其余常量与查询函数见文件末尾的返回对象
 *
 * 兼容性：无 document / window 依赖，可在浏览器 <script> 或 Node require 下运行。
 * ============================================================ */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GomokuAI = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

/* ---------------- 一、引擎常量（唯一权威定义，改这里即可） ---------------- */
const EMPTY = 0;

const BLACK = 1;

const WHITE = 2;

/* AI 难度档位标识 */
const LEVEL_EASY = 'easy';

const LEVEL_MEDIUM = 'medium';

const LEVEL_HARD = 'hard';

/* 搜索相关参数（仅困难档使用） */
const SEARCH_DEPTH = 3;

const CANDIDATE_LIMIT = 16;

const ROOT_CANDIDATE_LIMIT = 18;

const SEARCH_BUDGET_MS = 2500;

const MEDIUM_SEARCH_DEPTH = 3;

const MEDIUM_SEARCH_BUDGET_MS = 400;

const HINT_RADIUS = 2;

const WIN_SCORE = 100000000;

const LIVE_THREE_SCORE = 10000;

/* 置换表（Transposition Table）参数（困难档搜索加速） */
const TT_MAX_ENTRIES = 300000;

const TT_EXACT = 0;

const TT_LOWER = 1;

const TT_UPPER = 2;

const TT_SIDE_ME = 0x9E3779B9;

const TT_SIDE_OPP = 0x85EBCA77;

const TT_PERSP_BLACK = 0x6D2B79F5;

const TT_PERSP_WHITE = 0x1B56C4E9;

/* VCF（连续冲四杀棋）参数（中等/困难档使用） */
const VCF_MAX_PLIES = 10;

const VCF_NODE_LIMIT = 5000;

const VCF_TIME_BUDGET_MS = 250;

/* VCT（连续活三杀棋）参数（中等/困难档使用） */
const VCT_MAX_PLIES = 14;

const VCT_NODE_LIMIT = 30000;

const VCT_TIME_BUDGET_MS = 900;

/* 开局策略参数 */
const OPENING_TOTAL_MOVES = 8;

const OPENING_DOUBLE_BONUS = 20000;

/* 开局库覆盖的最大盘面子数（0~8 子，即前 9 手） */
const OPENING_BOOK_MAX_STONES = 8;

/* 局面评估权重 */
const CONNECT_BONUS = 30;

const CENTER_WEIGHT = 25;

const DOUBLE_THREAT_BONUS = 30000;

const TEMPO_BONUS = 1500;

                                   // AI 选点时双三=必争的杀招（满分计入），但胜率上双三
                                   // 并非强制胜（对方还有办法周旋），打 2.5 折避免直接飙到 98%。
/* 四个判胜方向：[行增量, 列增量]，即横、竖、主斜、副斜 */
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

/* 棋型评分表（行=连续同色子数，列=开放端数 0/1/2）：
 * 连得越多、两端越开放，威胁越大。所有静态评估的基础分都查这一张表。
 * 后续调“棋型价值”只需改这里一处。注意：reachable=false 的“死棋型”
 * （死四/死三等）永远凑不成五连，lineScore 直接记 0，不查表。
 *
 * 分档原则（P0 修正）：同连子数下开放性必须拉开档次，且“冲四 > 活三”必须成立。
 *   旧表 冲四=活三=10000，使 countThreats 判“双威胁”时无法区分
 *   “双活三”与“活三+冲四”（后者强度高一档）；眠二=活二=1000 也让低阶棋型无区分度。
 * 现值：活四 100000 >> 冲四 20000 > 活三 10000 > 眠三 1000 > 活二 300 > 眠二 100 > 活一 30 > 眠一 10
 * 约束：LIVE_THREE_SCORE=10000 是 countThreats 的“有效威胁”门槛，
 *       必须保持“活三(10000) 及以上算威胁、眠三(1000) 不算”。 */
const PATTERN_TABLE = [
  [0, 0, 0],            // 0 子（不会出现，占位）
  [10, 10, 30],         // 1 子：眠一 / 活一
  [100, 100, 300],      // 2 子：眠二 / 活二
  [1000, 1000, 10000],  // 3 子：眠三 / 活三
  [20000, 20000, 100000], // 4 子：冲四 / 活四（冲四取 20000 以确保高于活三）
  [1000000, 1000000, 1000000], // 5 子及以上：已成五连
];

/* ---------------- 二、引擎状态 ---------------- */
/* 棋盘：引擎自己持有，游戏侧通过 GomokuAI.board 直接读写（不要重新赋值棋盘变量） */
let boardSize = 19;
let board = Array.from({ length: boardSize }, () => Array(boardSize).fill(EMPTY));
let playerColor = BLACK;      // 玩家执子颜色（教学/推荐点视角）
let aiColor = WHITE;          // AI 执子颜色（AI 决策视角）
let moveVariety = 1;          // 出棋随机度 0~1：0=完全确定（测试/基准用），1=正常随机
let searchState = null;       // 搜索计时器 { t0, budget }
let lastVcfPath = null;       // 最近一次 VCF 杀棋路径（教学点评用）
let lastVctPath = null;       // 最近一次 VCT 杀棋路径（教学点评用）
let ttMap = null;             // 置换表
let ttZobrist = null;         // Zobrist 随机表
let boardHash = 0;            // 增量棋盘哈希
let historyTable = null;      // 历史启发表
let killerTable = null;       // 杀手表

/* ---------------- 三、引擎实现（由生成器逐字保留，请勿手工重排） ---------------- */
/* ============================================================
 * 四、工具函数
 * 说明：与具体规则无关的小工具，坐标换算、越界判断等
 * ============================================================ */
/** (r, c) 是否在棋盘范围内 */
function inBoard(r, c) {
  return r >= 0 && r < boardSize && c >= 0 && c < boardSize;
}

/**
 * VCF（Victory by Continuous Fours，连续冲四）杀棋检测。
 * 思路：连续下“冲四”，对方每一步都只能被迫挡这个冲四，
 * 一路把对方带到“活四/五连”为止——这就是一条强制胜序列。
 * 命中时返回当前这一步（首个强制落点），并把完整路径存入 lastVcfPath 供教学展示。
 * @param {number} color 进攻方颜色
 * @param {number} maxPlies 最大搜索层数（每层 = 己方一手 + 对方一手）
 * @returns {Array|null} [r, c]
 */
function findVcfWin(color, maxPlies = VCF_MAX_PLIES) {
  const opp = color === BLACK ? WHITE : BLACK;
  lastVcfPath = null;
  // 对方已可一步成五 → VCF 前提不成立（必须先防守）；
  // 我方已可一步成五 → 交给 findImmediateWin 处理即可。
  if (findImmediateWin(opp) || findImmediateWin(color)) return null;
  // 记录“最短连杀路径”：同一局面往往存在多条 VCF 路线，优先走手数最短的，
  // 因为对方被迫应的手数越少，越没有机会中途反杀，杀棋越稳。
  const vcf = { nodes: 0, t0: performance.now(), budget: VCF_TIME_BUDGET_MS, cur: [], bestLen: Infinity, bestPath: null };
  if (vcfSearch(color, opp, maxPlies, vcf, null, null) > 0 && vcf.bestPath && vcf.bestPath.length) {
    lastVcfPath = vcf.bestPath.slice();
    return vcf.bestPath[0];
  }
  return null;
}

/**
 * VCF 递归主体。
 * @param {number|null} lastR 上一手落点行（用于快速判五，null 表示根节点）
 * @param {number|null} lastC 上一手落点列
 * @returns {number} 从该节点取胜所需最少“己方手数”（>0 表示必胜，-1 表示无解/超限） */
function vcfSearch(color, opp, plies, vcf, lastR, lastC) {
  if (++vcf.nodes > VCF_NODE_LIMIT) return -1;               // 节点上限防卡顿
  if (performance.now() - vcf.t0 > vcf.budget) return -1;    // 时间上限防卡顿
  if (lastR !== null && canWinNow(lastR, lastC, color)) {
    if (vcf.cur.length < vcf.bestLen) {                      // vcf.cur 即“根到当前手”完整路径
      vcf.bestLen = vcf.cur.length;
      vcf.bestPath = vcf.cur.slice();
    }
    return 1;
  }
  if (plies <= 0) return -1;

  const forcing = vcfForcingMoves(color, opp);
  if (forcing.length === 0) return -1;

  let bestLen = Infinity;
  let bestMove = null;
  for (const [r, c, lv] of forcing) {
    board[r][c] = color;
    let len = -1;
    vcf.cur.push([r, c]);                  // 当前手进入路径（供最短路径记录）
    if (lv >= 3 || canWinNow(r, c, color)) {
      len = 1;                              // 直接成五或形成活四：对方无法一手化解
      if (vcf.cur.length < vcf.bestLen) {
        vcf.bestLen = vcf.cur.length;
        vcf.bestPath = vcf.cur.slice();
      }
    } else {
      const blocks = vcfBlockPoints(r, c, color);
      if (blocks.length >= 2) {
        len = 1;                            // 双四：对方只能堵一处，另一处照样成五
        if (vcf.cur.length < vcf.bestLen) {
          vcf.bestLen = vcf.cur.length;
          vcf.bestPath = vcf.cur.slice();
        }
      } else if (blocks.length === 1) {
        const [br, bc] = blocks[0];
        board[br][bc] = opp;
        const sub = vcfSearch(color, opp, plies - 1, vcf, r, c);
        board[br][bc] = EMPTY;
        if (sub > 0) len = sub + 1;         // 对方堵住后我们仍能连杀，总手数+1
      }
    }
    vcf.cur.pop();
    board[r][c] = EMPTY;
    // 只保留手数最短的分支：杀棋越短越稳（vcfForcingMoves 已按威胁等级排序）
    if (len > 0 && len < bestLen) { bestLen = len; bestMove = [r, c]; }
  }
  // 根节点处把最短路径起点记录下来，供 findVcfWin 返回
  if (bestMove) {
    if (vcf.cur.length === 0) vcf.bestMoveRoot = bestMove;
    return bestLen;
  }
  return -1;
}

/** 收集“落子后能形成冲四/活四/五连”的候选点，按威胁等级与启发式分降序 */
function vcfForcingMoves(color, opp) {
  const seen = new Set();
  const list = [];
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] === EMPTY) continue;
      for (let dr = -HINT_RADIUS; dr <= HINT_RADIUS; dr++) {
        for (let dc = -HINT_RADIUS; dc <= HINT_RADIUS; dc++) {
          const nr = r + dr, nc = c + dc;
          if (!inBoard(nr, nc) || board[nr][nc] !== EMPTY) continue;
          const key = nr * boardSize + nc;
          if (seen.has(key)) continue;
          seen.add(key);
          const lv = threatLevel(nr, nc, color);
          if (lv >= 2) list.push([nr, nc, lv]);
        }
      }
    }
  }
  list.sort((a, b) => b[2] - a[2] || scoreFor(b[0], b[1], color, opp) - scoreFor(a[0], a[1], color, opp));
  return list;
}

/** 我方在 (r, c) 落子形成冲四后，对方必须堵住的开放端点（冲四只有一个端点） */
function vcfBlockPoints(r, c, color) {
  const points = [];
  const seen = new Set();
  for (const [dr, dc] of DIRECTIONS) {
    const info = lineInfo(r, c, dr, dc, color);
    if (info.count < 4) continue;             // 只看能成四的方向
    // 找出这条连线的起点与终点（同色连子）
    let sr = r, sc = c;
    while (inBoard(sr - dr, sc - dc) && board[sr - dr][sc - dc] === color) { sr -= dr; sc -= dc; }
    let er = r, ec = c;
    while (inBoard(er + dr, ec + dc) && board[er + dr][ec + dc] === color) { er += dr; ec += dc; }
    // 两端中“为空”的一端，就是对方唯一必须堵的位置
    for (const [pr, pc] of [[sr - dr, sc - dc], [er + dr, ec + dc]]) {
      if (inBoard(pr, pc) && board[pr][pc] === EMPTY) {
        const key = pr * boardSize + pc;
        if (!seen.has(key)) { seen.add(key); points.push([pr, pc]); }
      }
    }
  }
  return points;
}

/**
 * VCT（Victory by Continuous Threats，连续活三杀棋）检测。
 * VCF 用“连续冲四”逼对方就范，VCT 则用“连续活三/双威胁”：
 * 每一步都落成对方必须防守的活三或双三，对方疲于堵点，
 * 直到我方把某条线走成活四/五连——这是中盘把优势直接兑现
 * 成杀棋、避免“有攻势却不会赢”的关键手段。
 * 命中时返回当前这一步（首个强制落点），并把完整路径存入
 * lastVctPath 供教学展示。
 * @param {number} color 进攻方颜色
 * @param {number} maxPlies 最大搜索层数（每层 = 己方一手 + 对方一手）
 * @returns {Array|null} [r, c]
 */
function findVctWin(color, maxPlies = VCT_MAX_PLIES) {
  const opp = color === BLACK ? WHITE : BLACK;
  lastVctPath = null;
  // 一步成五/对方一步成五交给更靠前的分层（findImmediateWin/VCF）处理
  if (findImmediateWin(opp) || findImmediateWin(color)) return null;
  const vct = { nodes: 0, t0: performance.now(), budget: VCT_TIME_BUDGET_MS, cur: [], bestLen: Infinity, bestPath: null };
  if (vctSearch(color, opp, maxPlies, vct, null, null) > 0 && vct.bestPath && vct.bestPath.length) {
    lastVctPath = vct.bestPath.slice();
    return vct.bestPath[0];
  }
  return null;
}

/**
 * VCT 递归主体（AND 节点语义）。
 * 我方每下一手“强制手”（活三/冲四/双威胁），对方为了不立刻输，
 * 必须在 vctBlockPoints 给出的防守点里落子；因此对每一个防守点
 * 都要递归验证“我方仍然能赢”，全部成立才认定这条活三链必胜。
 * @param {number|null} lastR 上一手落点行（null 表示根节点）
 * @param {number|null} lastC 上一手落点列
 * @returns {number} 从该节点取胜所需最少“己方手数”（>0 必胜，-1 无解/超限）
 */
function vctSearch(color, opp, plies, vct, lastR, lastC) {
  if (++vct.nodes > VCT_NODE_LIMIT) return -1;               // 节点上限防卡顿
  if (performance.now() - vct.t0 > vct.budget) return -1;    // 时间上限防卡顿
  if (lastR !== null && canWinNow(lastR, lastC, color)) {
    if (vct.cur.length < vct.bestLen) {                      // 记录最短杀棋路径
      vct.bestLen = vct.cur.length;
      vct.bestPath = vct.cur.slice();
    }
    return 1;
  }
  if (plies <= 0) return -1;

  const forcing = vctForcingMoves(color, opp);
  if (forcing.length === 0) return -1;

  let bestLen = Infinity;
  let bestMove = null;
  for (const [r, c, lv] of forcing) {
    board[r][c] = color;
    let len = -1;
    vct.cur.push([r, c]);                  // 当前手进入路径
    if (lv >= 3 || canWinNow(r, c, color)) {
      // 直接成五或形成活四：对方无法一手化解，本手即终点
      len = 1;
      if (vct.cur.length < vct.bestLen) {
        vct.bestLen = vct.cur.length;
        vct.bestPath = vct.cur.slice();
      }
    } else {
      const blocks = vctBlockPoints(r, c, color);
      if (blocks.length === 0) {
        len = -1;                          // 没有必须堵的点 → 对方可不应，不算强制
      } else {
        // AND 节点：对方无论堵哪个防守点，我方都必须还能赢
        let worst = 0;
        let allWin = true;
        for (const [br, bc] of blocks) {
          board[br][bc] = opp;
          const sub = vctSearch(color, opp, plies - 1, vct, r, c);
          board[br][bc] = EMPTY;
          if (sub <= 0) { allWin = false; break; }
          if (sub > worst) worst = sub;
        }
        if (allWin) len = worst + 1;       // 最坏防守下仍需的最少手数
      }
    }
    vct.cur.pop();
    board[r][c] = EMPTY;
    // 只保留手数最短的分支（vctForcingMoves 已按威胁等级排序）
    if (len > 0 && len < bestLen) { bestLen = len; bestMove = [r, c]; }
    // 一步即胜已经是最优，不必再试其余候选——VCT 的强制手（活三）
    // 比 VCF 的冲四多得多，不短路的话搜索树会在无关的活三点上爆炸。
    if (len === 1) break;
  }
  if (bestMove) {
    if (vct.cur.length === 0) vct.bestMoveRoot = bestMove;
    return bestLen;
  }
  return -1;
}

/** 收集 VCT 强制手候选：落子后能形成活三/冲四/活四/五连，或一手双威胁的点 */
function vctForcingMoves(color, opp) {
  const seen = new Set();
  const list = [];
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] === EMPTY) continue;
      for (let dr = -HINT_RADIUS; dr <= HINT_RADIUS; dr++) {
        for (let dc = -HINT_RADIUS; dc <= HINT_RADIUS; dc++) {
          const nr = r + dr, nc = c + dc;
          if (!inBoard(nr, nc) || board[nr][nc] !== EMPTY) continue;
          const key = nr * boardSize + nc;
          if (seen.has(key)) continue;
          seen.add(key);
          const lv = threatLevel(nr, nc, color);
          const thr = countThreats(nr, nc, color);
          // 威胁等级越高越靠前；双威胁（双三/三四）在同级里优先
          if (lv >= 1 || thr >= 2) list.push([nr, nc, lv, thr]);
        }
      }
    }
  }
  list.sort((a, b) => (b[2] * 10 + b[3]) - (a[2] * 10 + a[3]) || scoreFor(b[0], b[1], color, opp) - scoreFor(a[0], a[1], color, opp));
  return list;
}

/**
 * 我方在 (r, c) 落子后，对方为阻止威胁扩大必须抢占的防守点：
 * 活三的两个开放端点、冲四的开放端点（活四与成五不可防，无防守点）。
 * 多个方向产生的端点去重后返回。
 */
function vctBlockPoints(r, c, color) {
  const points = [];
  const seen = new Set();
  for (const [dr, dc] of DIRECTIONS) {
    const info = lineInfo(r, c, dr, dc, color);
    if (info.count < 3) continue;                     // 只看能成三/四的方向
    if (info.count >= 4 && info.open === 2) continue; // 活四：不可防，直接算赢
    // 找出这条连续同色线段的两个端点
    let sr = r, sc = c;
    while (inBoard(sr - dr, sc - dc) && board[sr - dr][sc - dc] === color) { sr -= dr; sc -= dc; }
    let er = r, ec = c;
    while (inBoard(er + dr, ec + dc) && board[er + dr][ec + dc] === color) { er += dr; ec += dc; }
    for (const [pr, pc] of [[sr - dr, sc - dc], [er + dr, ec + dc]]) {
      if (inBoard(pr, pc) && board[pr][pc] === EMPTY) {
        const key = pr * boardSize + pc;
        if (!seen.has(key)) { seen.add(key); points.push([pr, pc]); }
      }
    }
  }
  return points;
}

/**
 * VCT 防守：对方存在活三链杀威胁时，抢占对方“活三/冲四”连线的
 * 开放端点，让对方的活三链断掉。选点优先“自己还能顺势反击”的位置。
 * @param {number} color 对方颜色
 * @returns {Array|null} [r, c]
 */
function vctDefense(color) {
  const me = color === BLACK ? WHITE : BLACK;
  let best = null;
  let bestScore = -Infinity;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== color) continue;
      for (const [dr, dc] of DIRECTIONS) {
        const info = lineInfo(r, c, dr, dc, color);
        if (info.count < 3) continue;                 // 只看对方能继续延伸的线
        // 找连续线段两端，空端就是必须堵的位置
        let sr = r, sc = c;
        while (inBoard(sr - dr, sc - dc) && board[sr - dr][sc - dc] === color) { sr -= dr; sc -= dc; }
        let er = r, ec = c;
        while (inBoard(er + dr, ec + dc) && board[er + dr][ec + dc] === color) { er += dr; ec += dc; }
        for (const [pr, pc] of [[sr - dr, sc - dc], [er + dr, ec + dc]]) {
          if (!inBoard(pr, pc) || board[pr][pc] !== EMPTY) continue;
          // 反击分：堵住的同时若能形成自己的活三/冲四，优先选它
          const lv = threatLevel(pr, pc, me);
          const s = scoreFor(pr, pc, me, color) + (lv >= 1 ? lv * 12000 : 0);
          if (s > bestScore) { bestScore = s; best = [pr, pc]; }
        }
      }
    }
  }
  return best;
}

/**
 * 双杀检测：一手落子后形成“不可防”的双重威胁（双四 / 活四+任意），
 * 对方一步只能处理其中一处，另一处下一手必然成五。
 * @returns {Array|null} [r, c]
 */
function findDoubleThreat(color) {
  const opp = color === BLACK ? WHITE : BLACK;
  let best = null;
  let bestScore = -Infinity;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) continue;
      let maxLv = 0;
      let forcing = 0;                        // 冲四/活四方向数
      for (const [dr, dc] of DIRECTIONS) {
        const info = lineInfo(r, c, dr, dc, color);
        let lv = 0;
        if (info.count >= 5) lv = 4;
        else if (info.count === 4 && info.open === 2) lv = 3;
        else if (info.count === 4 && info.open === 1) lv = 2;
        else if (info.count === 3 && info.open === 2) lv = 1;
        if (lv >= 2) forcing++;
        if (lv > maxLv) maxLv = lv;
      }
      if (maxLv < 3 && forcing < 2) continue; // 只有活四（3）或双冲四（2+2）才算不可防
      const s = scoreFor(r, c, color, opp);
      if (s > bestScore) { bestScore = s; best = [r, c]; }
    }
  }
  return best;
}

/**
 * 双三/双威胁“阵法杀招”检测：一手落子后形成两个“活三以上”威胁
 * （双三/活三+冲四/双四），对方一步只能堵一处，是五子棋最典型的
 * 必胜阵型——中盘把握住它就能把优势直接兑现成杀棋。
 * 前提：对方没有更快威胁（不能一步成五、也不能一手成活四），
 * 否则必须先防守，双杀只是空谈。
 * @param {number} color 行动方颜色
 * @returns {Array|null} 杀招落点 [r, c]；不存在则返回 null
 */
function findDoubleKill(color) {
  const opp = color === BLACK ? WHITE : BLACK;
  if (findImmediateWin(opp)) return null;   // 对方能一步成五 → 必须先挡
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) continue;
      // 对方能一手成活四（含把已有活三延伸成活四）→ 对方两子内成五，
      // 比我方双三（约三子内成五）更快，必须放弃进攻先防守
      if (threatLevel(r, c, opp) >= 3) return null;
    }
  }
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) continue;
      if (countThreats(r, c, color) >= 2) return [r, c];
    }
  }
  return null;
}

/**
 * 对方双杀威胁防守（对手意图判断的核心战术）：
 * 找出“对方下一步落子即可一手形成 ≥2 个活三以上威胁（双三/三四/双四）”的空位。
 * 这类点一旦让给对方，对方就拥有不可防的强制胜，因此我方必须抢先占住。
 * 选点优先“挡住后自己还能顺势反击”的位置（用己方视角的 scoreFor 决胜）。
 * @param {number} color 对方颜色
 * @returns {Array|null} 需要堵住的点 [r, c]；不存在则返回 null
 */
function findOpponentDoubleThreat(color) {
  const me = color === BLACK ? WHITE : BLACK;
  let best = null;
  let bestScore = -Infinity;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) continue;
      // countThreats 会“假装”在该点落子统计威胁数（lineInfo 不写棋盘）
      if (countThreats(r, c, color) >= 2) {
        const s = scoreFor(r, c, me, color);   // 己方视角：能反击的点优先
        if (s > bestScore) { bestScore = s; best = [r, c]; }
      }
    }
  }
  return best;
}

/**
 * 开局策略（AI 前若干手）：把落点限制在中心 9×9 区域，
 * 优先选“与已有己方子构成两个方向发展”的点；对方占天元时呼应天元旁星位。
 * 从得分最高的前几名里带权随机选一手，让 AI 面对同一种开局时出棋不重样。
 * @param {string} [level] 当前难度，决定随机候选数（简单变化大、困难收敛）
 * @returns {Array|null} [r, c]
 */
function openingMove(level) {
  // 用棋盘上的棋子数判断是否仍在开局阶段（不依赖外部状态，便于测试）
  let placed = 0;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) placed++;
    }
  }
  if (placed >= OPENING_TOTAL_MOVES) return null;
  const center = (boardSize - 1) / 2;
  const half = 4;                                   // 中心 9×9 区域
  const oppAtCenter = board[center][center] === playerColor;  // 对方是否占了天元
  const candidates = [];
  for (let r = Math.max(0, center - half); r <= Math.min(boardSize - 1, center + half); r++) {
    for (let c = Math.max(0, center - half); c <= Math.min(boardSize - 1, center + half); c++) {
      if (board[r][c] !== EMPTY) continue;
      let s = scoreFor(r, c);
      // 双方向发展：落子后能在两个不同方向延伸已有己方子 → 开局更灵活
      let dirs = 0;
      for (const [dr, dc] of DIRECTIONS) {
        const info = lineInfo(r, c, dr, dc, aiColor);
        if (info.count >= 2 && info.open >= 1) dirs++;
      }
      if (dirs >= 2) s += OPENING_DOUBLE_BONUS;
      // 中心偏好：越靠近天元越容易向四周展开
      const dist = Math.abs(r - center) + Math.abs(c - center);
      s += (2 * half - dist) * 120;
      // 呼应星位：对方占天元时，AI 优先落天元旁 2~3 格的星位展开
      if (oppAtCenter && dist >= 2 && dist <= 3) s += 1500;
      candidates.push({ r, c, s });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.s - a.s);             // 分数降序，供 pickVaried 取头部
  return pickVaried(candidates, pickTopN(level, 'opening'));
}

/**
 * 开局库查询：把当前局面做 8 对称规范化后查表，命中则返回库内应答。
 * 开局库由 work/gen-opening-book.js 用引擎自身深度 3 搜索生成，覆盖
 * 盘面 0~8 子（前 9 手）。命中时 AI 开局有章法、响应快，且同一开局
 * 按权重随机换着下（配合 moveVariety：=0 恒取最强，>0 按权重 5~1 随机）；
 * hard 只在前 2 名里浮动、medium 前 3 名，兼顾强度与“变幻莫测”。
 * @param {string} level 难度档位，决定随机候选范围
 * @param {number} side 行动方颜色（BLACK/WHITE），决定查表 key 的前缀
 * @returns {Array|null} [r, c]；未命中返回 null
 */
function bookMove(level, side) {
  // 统计盘面棋子数：开局库只覆盖 0~5 子，超出直接返回
  // （不依赖页面全局 moveCount，便于测试环境独立运行）
  let placed = 0;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) placed++;
    }
  }
  if (placed > OPENING_BOOK_MAX_STONES) return null;

  // 8 对称变换表（与生成器一致）：相对天元坐标 (x,y)=(r-center, c-center)。
  // INV 为逆变换，把库内“规范朝向”的相对坐标还原到当前棋盘的实际朝向
  const SYM = [
    (x, y) => [x, y], (x, y) => [-y, x], (x, y) => [-x, -y], (x, y) => [y, -x],
    (x, y) => [x, -y], (x, y) => [-x, y], (x, y) => [y, x], (x, y) => [-y, -x],
  ];
  const INV = [0, 3, 2, 1, 4, 5, 6, 7];
  const center = (boardSize - 1) / 2;

  // 规范化：从 8 个朝向里“字典序最小的棋子坐标串”作为 key。
  // 同一开局无论旋转/镜像都命中同一个 key（生成器与这里完全一致）
  let bestStr = null;
  let bestSym = 0;
  for (let s = 0; s < 8; s++) {
    const pts = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const color = board[r][c];
        if (color === EMPTY) continue;
        const [tx, ty] = SYM[s](r - center, c - center);
        pts.push([tx, ty, color]);
      }
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const str = pts.map(p => p[0] + ',' + p[1] + ',' + p[2]).join(';');
    if (bestStr === null || str < bestStr) { bestStr = str; bestSym = s; }
  }
  const entries = OPENING_BOOK[(side === BLACK ? 'B' : 'W') + '|' + bestStr];
  if (!entries || entries.length === 0) return null;

  // 按难度限制随机候选数并带权选取（权重 5~1 = 生成器的搜索分排序）
  const topN = { easy: 5, medium: 3, hard: 2 }[level] || 3;
  const n = Math.min(topN, entries.length);
  let idx = 0;
  if (moveVariety > 0 && n > 1) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += entries[i][2];
    let roll = Math.random() * sum;
    for (let i = 0; i < n; i++) {
      roll -= entries[i][2];
      if (roll <= 0) { idx = i; break; }
    }
  }
  // 逆对称还原绝对坐标；13/15 小棋盘越界或目标已被占时返回 null，交由上层兜底
  const [x, y] = SYM[INV[bestSym]](entries[idx][0], entries[idx][1]);
  const r = center + x;
  const c = center + y;
  if (!inBoard(r, c) || board[r][c] !== EMPTY) return null;
  return [r, c];
}

/**
 * 获取当前难度下的最佳落点。
 * @param {string} level 难度档位（LEVEL_EASY / LEVEL_MEDIUM / LEVEL_HARD）
 * @param {number} [forColor] 计算视角的颜色；缺省用 aiColor（AI 实战决策）；
 *        教学推荐点时用 playerColor，用“玩家视角”计算，保证建议真正利于玩家。
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

  // 中等/困难档：完整威胁分层（一步成五 → VCF → 双杀 → 活四/活三攻防 → 开局库 → 启发式开局 → 搜索）
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
    // 放在双杀之后：双杀一手可成、更便宜；VCT 是多手链条，是中盘转化胜势的关键。
    const vctWin = findVctWin(me);
    if (vctWin) return vctWin;
    // 对方存在活三链杀 → 必须先堵对方活三/冲四的开放端点。
    // 注意：对方 VCT 路径只用于决策，不写入 lastVctPath（教学只展示 AI 自己的杀棋路径）。
    const oppVct = findVctWin(opp);
    lastVctPath = null;
    if (oppVct) {
      const vctDef = vctDefense(opp);
      if (vctDef) return vctDef;
    }
    // 对方双杀意图防守：对方下一步一手可成双三/三四/双四 → 抢先堵住关键点
    const oppDt = findOpponentDoubleThreat(opp);
    if (oppDt) return oppDt;
    // 常规攻防：己方活三（进攻优先）与防守反击选点；不强制堵对方眠三开放端。
    // 把“堵还是进攻”交给搜索/评分按全局分数权衡，避免过度防守。
    const threat = resolveThreats(me, opp, false, false);
    if (threat) return threat;
    // 开局库（盘面 0~8 子）：没有即时战术时才按库内定式应手（引擎自身搜索生成，带权随机增加变化）。
    // 放在战术层之后：更深的开局局面也可能出现活三/冲四等威胁，先保证战术正确，安静局面再走定式。
    const book = bookMove(level, me);
    if (book) return book;
    // 启发式开局策略（0~8 子兜底，开局库未覆盖时按套路布局，带随机出棋不重样）
    if (me === aiColor) {
      const o = openingMove(level);
      if (o) return o;
    }
  }
  if (level === LEVEL_HARD) return bestBySearch(me, opp, level);
  // 中等档：在威胁分层（活三/冲四/双杀等）之上叠加 3 层浅搜索，
  // 让中盘的“布阵”不再只看单步打分，而是向前多看两三手的发展
  if (level === LEVEL_MEDIUM) return bestBySearch(me, opp, level, MEDIUM_SEARCH_BUDGET_MS, MEDIUM_SEARCH_DEPTH);
  return bestByScore(me, opp, level);
}

/**
 * 单步启发式：遍历所有空位，综合“进攻分（自己成五）”、
 * “防守分（阻挡玩家）”与“中心偏好”选出得分最高的位置。 */
/**
 * 单步启发式：遍历所有空位，综合“进攻分（自己成五）”、
 * “防守分（阻挡对方）”与“中心偏好”选出得分最高的位置。
 * 同分/接近分时在前 topN 名里带权随机，避免同一局面永远下同一手。
 * @param {string} [level] 当前难度，决定随机候选数
 */
function bestByScore(me = aiColor, opp = playerColor, level) {
  const candidates = [];
  const center = (boardSize - 1) / 2;           // 中心坐标随格数变化
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) continue;

      const attack = evaluateCell(r, c, me);    // 进攻：自己连线
      const defend = evaluateCell(r, c, opp);   // 防守：阻挡对方
      // 阵法加成：一手能形成双威胁（双三/三四/双四）是五子棋最强的进攻结构，
      // 安静局面下优先布这种“杀招阵型”，而不是零散地凑单线。
      const dtBonus = countThreats(r, c, me) >= 2 ? DOUBLE_THREAT_BONUS : 0;
      const centerBias = (2 * (boardSize - 1) - (Math.abs(r - center) + Math.abs(c - center))) / 10;
      candidates.push({ r, c, s: attack + defend * 0.8 + dtBonus + centerBias });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.s - a.s);         // 分数降序，供 pickVaried 取头部
  return pickVaried(candidates, pickTopN(level));
}

/** 假设在 (r, c) 放一颗 color 棋，四个方向连子得分之和（含组合加权） */
function evaluateCell(r, c, color) {
  let total = 0;
  for (const [dr, dc] of DIRECTIONS) {
    total += directionScore(r, c, dr, dc, color);
  }
  // 近似“双三/双四”：同一落点能同时形成两个活三级别的威胁时加权翻倍。
  // 这是五子棋里极难防守的棋形，必须给予额外权重。
  if (total >= LIVE_THREE_SCORE * 2) total *= 2;
  return total;
}

/**
 * 统计在 (dr, dc) 方向上以 (r, c) 为中心的连子信息。
 * 关键改进：除了连子数与开放端，还计算“这条线是否还有足够空间真正连成五子”，
 * 避免 AI 去凑“两端被封死、只有四个子的空间”的死棋型。
 * @returns {{count: number, open: number, reachable: boolean}}
 *   count      连续同色子数（含当前点）
 *   open       开放端数（0~2，指该端紧邻至少一个空位）
 *   reachable  是否有足够空间连成五：count + 两端连续空位数 >= 5
 */
function lineInfo(r, c, dr, dc, color) {
  let count = 1;
  let open = 0;
  let totalSpace = 0;

  for (const dir of [1, -1]) {      // 先正向再反向
    let i = 1;
    for (; i < 5; i++) {            // 数同色连子
      const nr = r + dr * i * dir;
      const nc = c + dc * i * dir;
      if (!inBoard(nr, nc)) break;  // 越界：该端封死
      if (board[nr][nc] === color) {
        count++;
      } else {
        break;                      // 遇到空位或对手棋子，连子结束
      }
    }
    // 连子结束后，数这一端还能连续放下几个空位（最多 4 个）
    // 只有空位数量足够，这端才有机会把连子“续”成五连
    let space = 0;
    for (let j = i; j < i + 4; j++) {
      const nr = r + dr * j * dir;
      const nc = c + dc * j * dir;
      if (!inBoard(nr, nc) || board[nr][nc] !== EMPTY) break;
      space++;
    }
    if (space > 0) open++;
    totalSpace += space;
  }

  // 可达性：连子数 + 两端空位数必须 >= 5，否则永远凑不成五连。
  // 例：B X X X _ B 的“眠三”只有 1 个空位，3+1=4 < 5，实际是死棋型。
  const reachable = count + totalSpace >= 5;
  return { count, open, reachable };
}

/** 沿某方向的连子得分（由 lineInfo 计算出的棋型查表得到） */
function directionScore(r, c, dr, dc, color) {
  const info = lineInfo(r, c, dr, dc, color);
  return lineScore(info.count, info.open, info.reachable);
}

/**
 * 连子评分（查棋型表）：连得越多、两端越开放，威胁越大。
 * reachable=false 的死棋型（死四/死三等）永远无法成五，直接记 0 分，
 * 避免 AI 为了凑四子而在注定被堵死的线上浪费一手。 */
function lineScore(count, open, reachable) {
  if (count >= 5) return PATTERN_TABLE[5][0];                  // 已成五连
  if (!reachable) return 0;                                    // 空间不足，永远无法成五
  return PATTERN_TABLE[count][open] || 0;
}

/**
 * 威胁等级：在 (r, c) 放 color 后，四个方向中能形成的最强威胁。
 * 这是“大局观”的基础指标——AI 依据它判断一步棋究竟是普通落子、
 * 活三、冲四还是活四，从而决定进攻还是防守。
 * @returns {number} 0=普通落子 1=活三 2=冲四 3=活四 4=五连
 */
function threatLevel(r, c, color) {
  let best = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const info = lineInfo(r, c, dr, dc, color);
    let lv = 0;
    if (info.count >= 5) lv = 4;                        // 直接成五
    else if (info.count === 4 && info.open === 2) lv = 3;  // 活四：两端都开，无敌
    else if (info.count === 4 && info.open === 1) lv = 2;  // 冲四：单端开，逼对方应对
    else if (info.count === 3 && info.open === 2) lv = 1;  // 活三：能发展成活四
    if (lv > best) best = lv;
  }
  return best;
}

/**
 * 一步必杀检测：若在 (r, c) 放 color 能立刻成五则返回该点。
 * 用 canWinNow 直接数连子，不修改棋盘，速度比“临时落子再判胜”快得多。 */
function findImmediateWin(color) {
  // 成五点必然紧邻同色棋子（五连中除当前点外的 4 颗都在半径 1 内），
  // 只查同色棋子相邻 8 格的空位即可，避免每个搜索节点全盘扫描 361 格。
  const seen = new Set();
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== color) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (!inBoard(nr, nc) || board[nr][nc] !== EMPTY) continue;
          const key = nr * boardSize + nc;
          if (seen.has(key)) continue;
          seen.add(key);
          if (canWinNow(nr, nc, color)) return [nr, nc];
        }
      }
    }
  }
  return null;
}

/** 快速判断：把 color 放在 (r, c) 后是否形成五连（不修改棋盘） */
function canWinNow(r, c, color) {
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    for (const dir of [1, -1]) {
      for (let i = 1; i < 5; i++) {
        const nr = r + dr * i * dir;
        const nc = c + dc * i * dir;
        if (!inBoard(nr, nc) || board[nr][nc] !== color) break;
        count++;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

/** 单点启发式得分，供候选点排序使用 */
function scoreFor(r, c, me = aiColor, opp = playerColor) {
  return evaluateCell(r, c, me) + evaluateCell(r, c, opp) * 0.8;
}

/**
 * 带权随机选点：在得分最高的 topN 个候选中按“排名权重”随机取一个。
 * （第 1 名权重 1、第 2 名 1/2、第 3 名 1/3……）。
 * 效果：面对对方同一种开局，AI 不再永远下同一手，而是从几个同等级
 * 的好点里随机应变；头部仍大概率命中，强度损失很小。
 * moveVariety=0 时退化为取第一名，保证确定性（自动化测试场景）。
 * @param {Array<{r:number,c:number,s:number}>} list 已按分数降序的候选列表
 * @param {number} topN 参与随机的前几名
 * @returns {Array|null} [r, c]
 */
function pickVaried(list, topN) {
  if (!list || list.length === 0) return null;
  if (moveVariety <= 0 || topN <= 1) return [list[0].r, list[0].c];
  const n = Math.min(topN, list.length);
  let sum = 0;
  const weights = [];
  for (let i = 0; i < n; i++) {
    const w = 1 / (i + 1);
    weights.push(w);
    sum += w;
  }
  let roll = Math.random() * sum;
  for (let i = 0; i < n; i++) {
    roll -= weights[i];
    if (roll <= 0) return [list[i].r, list[i].c];
  }
  return [list[n - 1].r, list[n - 1].c];
}

/**
 * 各难度出棋的随机候选数：难度越高越收敛。
 * easy 变化最大（新手也能看到多种走法），hard 只在前 2 名里小幅浮动。 */
function pickTopN(level, kind) {
  const table = kind === 'opening'
    ? { easy: 4, medium: 3, hard: 2 }
    : { easy: 5, medium: 3, hard: 2 };
  return table[level] || 3;
}

/**
 * 威胁分层决策（中等/困难共用，在“一步成五”与 VCF/双杀检测之后调用）。
 * 解决三个痛点：
 * ① 以前 AI 只挡“必成五”，会漏掉对方的活三/眠三（三个子）；
 * ② 残局空位变少时，AI 仍能按威胁优先级行动，而不是东一子西一子乱下；
 * ③ 以前挡棋只求“挡住”，不挑位置——现在优先选“挡住又能反击”的落点，
 *    把被动防守变成主动进攻，从而更快赢下对局。
 * 优先级（从高到低）：
 *   自己活四 > 挡对方活四 > 挡对方冲四端点（眠三开放端，可选）> 自己活三 > 交给搜索/评分。
 * skipOwnAttack=true 时跳过“自己活三”这一档，只返回紧急攻防——
 * 供“先判断对方双杀意图、再决定是否进攻”的调用顺序使用。
 * blockRushFours=false 时不强制堵“对方眠三的开放端”（对方三连一端已死）。
 * 这种棋型对方即使冲四也只是一步一步被挡，并不构成杀棋；把这一步让给
 * 搜索/评分去权衡，AI 就能优先做能赢的棋，而不是机械地处处设防。
 * 只有对方存在 VCF 连续冲四杀棋时（getBestMove 的 VCF 分支）才强制堵冲四端点。
 * 颜色可参数化：AI 决策默认 (aiColor, playerColor)；教学推荐玩家时传 (playerColor, aiColor)。
 * @param {boolean} [skipOwnAttack] true=不返回自己活三（留给更高级的进攻判断）
 * @param {boolean} [blockRushFours] true=对方眠三开放端（冲四形成点）也强制堵
 * @returns {Array|null} 需要立即执行的落点 [r, c]，没有紧急威胁则返回 null
 */
function resolveThreats(me = aiColor, opp = playerColor, skipOwnAttack, blockRushFours = true) {
  let aiBest = null;        // 自己威胁最大的空位
  let playerBest = null;    // 对方威胁最大的空位
  const center = (boardSize - 1) / 2;

  // 防守反击加分：挡棋点若同时能让我方形成活三(1)/冲四(2)/活四(3)，
  // 额外加权，让 AI 尽量选“既挡得住、又能顺势反击”的位置。
  // 为什么单独再加一次？scoreFor 的进攻分把低价值连线（活一/眠二）也算进来，
  // 而这里只奖励“真正的强威胁”（活三以上），保证防守选点瞄准反击，而不是零碎连线。
  const counterScore = (r, c) => {
    const lv = threatLevel(r, c, me);
    return lv >= 1 ? lv * 12000 : 0;
  };

  // 同等级威胁用启发式分 + 防守反击分 + 中心偏好决胜：
  // 进攻点只看启发式分与中心偏好；防守点额外叠加反击分，选“能赢的位置”去挡。
  const tieScore = (r, c, defensive) =>
    scoreFor(r, c, me, opp) + (defensive ? counterScore(r, c) : 0)
    + (countThreats(r, c, me) >= 2 ? 20000 : 0)   // 同等级威胁里优先“一手双威胁”的杀招点
    - (Math.abs(r - center) + Math.abs(c - center)) * 0.5;
  const consider = (cur, r, c, lv, defensive) => {
    if (!cur || lv > cur.lv || (lv === cur.lv && tieScore(r, c, defensive) > tieScore(cur.r, cur.c, defensive))) {
      return { r, c, lv };
    }
    return cur;
  };

  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) continue;
      const a = threatLevel(r, c, me);
      if (a >= 1) aiBest = consider(aiBest, r, c, a, false);
      const p = threatLevel(r, c, opp);
      if (p >= 1) playerBest = consider(playerBest, r, c, p, true);
    }
  }

  if (aiBest && aiBest.lv >= 3) return [aiBest.r, aiBest.c];           // 自己成活四：无解进攻，立刻下
  if (playerBest && playerBest.lv >= 3) return [playerBest.r, playerBest.c]; // 对方成活四：必须挡
  if (blockRushFours && playerBest && playerBest.lv === 2) return [playerBest.r, playerBest.c]; // 在 VCF 防守等场景强制堵冲四端点
  if (!skipOwnAttack && aiBest && aiBest.lv === 1) return [aiBest.r, aiBest.c]; // 自己活三：主动进攻，建立连攻
  return null;
}

/**
 * 生成候选落点：只收集“已有棋子周围 HINT_RADIUS 格内”的空位，
 * 再按启发式得分降序取前 limit 个。
 * 理由：远离棋子的落点在开局阶段几乎无意义，裁剪可大幅缩小搜索树。 */
function getCandidateMoves(limit, color) {
  const seen = new Set();
  const list = [];
  const opp = color === BLACK ? WHITE : BLACK;

  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] === EMPTY) continue;
      for (let dr = -HINT_RADIUS; dr <= HINT_RADIUS; dr++) {
        for (let dc = -HINT_RADIUS; dc <= HINT_RADIUS; dc++) {
          const nr = r + dr, nc = c + dc;
          if (!inBoard(nr, nc) || board[nr][nc] !== EMPTY) continue;
          const key = nr * boardSize + nc;
          if (seen.has(key)) continue;
          seen.add(key);
          list.push([nr, nc]);
        }
      }
    }
  }

  const scored = list.map(([r, c]) => {
    // 强制走法（能形成冲四/活四的点）排最前：搜索先验证关键点，剪枝更有效
    const forcing = color ? threatLevel(r, c, color) * 8000 : 0;
    // 双杀候选（一手形成两个活三以上威胁）再加权：优先探索必胜路线
    const doubleThreat = color && countThreats(r, c, color) >= 2 ? 16000 : 0;
    return { r, c, s: scoreFor(r, c, color, opp) + forcing + doubleThreat };
  });
  scored.sort((a, b) => b.s - a.s);   // 降序：高分候选在前，剪枝更有效
  return scored.slice(0, limit).map(({ r, c }) => [r, c]);
}

/**
 * 全局面静态评估：AI 方总进攻分 − 玩家方总进攻分 × 1.1。
 * 关键改进：每条连线只从“起点”计一次分，避免一条活三被三个子重复计 3 倍，
 * 棋盘越满评估越失真。防守权重略高（1.1），让 AI 攻防取舍时稍微偏保守。 */
/**
 * 威胁空间统计（对方威胁空间的评估基础）：围绕 color 棋子，统计“落子后能
 * 形成活三以上威胁”的空位，并按威胁等级加权（活三 600 / 冲四 2000 /
 * 活四 15000 / 成五 80000）。它衡量一方的“进攻选择面”——同样一条活三，
 * 能延伸成活四的选点多的一方更主动；对方威胁空间越大，越不能安心进攻。
 * 与 comboBonus 的分工：comboBonus 只奖励“一手双威胁”的杀招点，这里把
 * 普通单线威胁也算进来，让叶节点评估不再只盯着必杀点、有全局大局观。
 * 数量上限 cap 控制评估开销（minimax 叶节点调用非常频繁）。 */
function threatSpaceBonus(color, cap = 48) {
  let bonus = 0;
  let checked = 0;
  const seen = new Set();
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== color) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (!inBoard(nr, nc) || board[nr][nc] !== EMPTY) continue;
          const key = nr * boardSize + nc;
          if (seen.has(key)) continue;
          seen.add(key);
          if (++checked > cap) return bonus;
          const lv = threatLevel(nr, nc, color);
          if (lv >= 1) bonus += [0, 600, 2000, 15000, 80000][lv];
        }
      }
    }
  }
  return bonus;
}

/**
 * 局面评估：己方全部棋型分 − 对方全部棋型分×1.1，另加连接性、中心权重、
 * 双威胁组合分与“威胁空间”分（见 threatSpaceBonus）。
 * @param {number} [comboWeight] 双威胁/威胁空间分的折扣系数：AI 决策用 1；
 *        胜率估算用 0.25，避免“双三/活三延伸”这类强而不必胜的棋型把胜率推过高。 */
function evaluateBoard(me = aiColor, opp = playerColor, comboWeight = 1, tempoFor = null) {
  let aiScore = 0;
  let playerScore = 0;
  let aiAdj = 0;
  let playerAdj = 0;
  const center = (boardSize - 1) / 2;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const color = board[r][c];
      if (color === EMPTY) continue;
      for (const [dr, dc] of DIRECTIONS) {
        // 只统计这条连线的起点（r-dr, c-dc 不是同色子），一行只计一次
        const pr = r - dr, pc = c - dc;
        if (inBoard(pr, pc) && board[pr][pc] === color) continue;
        const info = lineInfo(r, c, dr, dc, color);
        const s = lineScore(info.count, info.open, info.reachable);
        if (color === me) aiScore += s;
        else playerScore += s;
      }
      // 连接性：与同色相邻的子数（鼓励进攻抱团，避免单子乱飞）
      let adj = 0;
      for (const [dr, dc] of DIRECTIONS) {
        const nr = r + dr, nc = c + dc;
        if (inBoard(nr, nc) && board[nr][nc] === color) adj++;
      }
      // 中心位置权重：越靠近天元，向四周展开的空间越大（大局观）
      const dist = Math.abs(r - center) + Math.abs(c - center);
      const posW = boardSize - dist;
      if (color === me) { aiAdj += adj; aiScore += posW * CENTER_WEIGHT; }
      else { playerAdj += adj; playerScore += posW * CENTER_WEIGHT; }
    }
  }
  // comboWeight：默认 1（AI 决策用，双三=强杀招）；胜率估算时传入折扣系数，
  // 让“双三候选”这类强而不必胜的棋型不至于把胜率推到 98% 的封顶值。
  aiScore += comboBonus(me) * comboWeight;
  playerScore += comboBonus(opp) * comboWeight;
  // 威胁空间：双方各有多少个“一手成活三以上”的选点（进攻灵活度/对方反击空间）。
  // 双威胁杀招由 comboBonus 单独计，这里只补单线威胁，避免重复；对方威胁空间
  // 同样×1.1，让 AI 进攻时始终把对手的反击空间考虑进去（全局大局观）。
  const aiSpace = threatSpaceBonus(me) * comboWeight;
  const playerSpace = threatSpaceBonus(opp) * comboWeight;
  const raw = (aiScore + aiAdj * CONNECT_BONUS + aiSpace)
            - (playerScore + playerAdj * CONNECT_BONUS + playerSpace) * 1.1;
  // 先手权（tempo）修正：轮到谁走，谁有先行展开权。双方各有一个活三时
  // 静态棋型分完全一样，但先手方下一手就能把活三变活四锁定胜局——
  // 不修正会让浅层搜索严重误判这类“先手决定胜负”的局面。
  if (tempoFor === me) return raw + TEMPO_BONUS;
  if (tempoFor === opp) return raw - TEMPO_BONUS;
  return raw;
}

/**
 * 双威胁组合加分：某个空位一手可同时形成两个“活三以上”威胁（双三/双四），
 * 对方一步只能堵一处，是极难防守的杀棋。只扫描“己方棋子相邻”的空位，
 * 并设数量上限，控制评估开销（否则 minimax 叶节点会明显变慢）。 */
function comboBonus(color) {
  let bonus = 0, checked = 0;
  const seen = new Set();
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== color) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (!inBoard(nr, nc) || board[nr][nc] !== EMPTY) continue;
          const key = nr * boardSize + nc;
          if (seen.has(key)) continue;
          seen.add(key);
          if (++checked > 128) return bonus;
          if (countThreats(nr, nc, color) >= 2) bonus += DOUBLE_THREAT_BONUS;
        }
      }
    }
  }
  return bonus;
}

/**
 * 统计在 (r, c) 放 color 后，四个方向中“有效威胁”（活三及以上：
 * 活三/冲四/活四/五连）的数量。威胁数 >= 2 意味着对方一手无法同时处理。 */
function countThreats(r, c, color) {
  let n = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const info = lineInfo(r, c, dr, dc, color);
    const s = lineScore(info.count, info.open, info.reachable);
    if (s >= LIVE_THREE_SCORE) n++;
  }
  return n;
}

/**
 * 初始化搜索加速表（置换表 + 历史启发）。
 * 每次 bestBySearch 开始时调用：重建棋盘哈希、清空置换表，保证
 * 哈希随机底数与棋盘状态一致（棋盘可能因前一手落子而变化）。 */
function initSearchTables() {
  if (!ttZobrist) {
    // 首次生成 Zobrist 随机底数：每个 (位置, 颜色) 一个 32 位随机整数。
    // 按 19×19 固定尺寸；13/15 棋盘只使用左上部分，不影响哈希正确性。
    ttZobrist = [];
    for (let r = 0; r < 19; r++) {
      ttZobrist[r] = [];
      for (let c = 0; c < 19; c++) {
        ttZobrist[r][c] = [
          (Math.random() * 0xFFFFFFFF) | 0,
          (Math.random() * 0xFFFFFFFF) | 0
        ];
      }
    }
  }
  // 跨步置换表：ttMap / historyTable / killerTable 在整局内跨落子持续复用。
  // 相同局面（含“轮到谁”与搜索视角）的搜索结果直接复用，后续每一步都能
  // 吃到前几步搜索积累的缓存，同一预算下看得更深。哈希随机底数只在首次
  // 生成、整页稳定；ttStore 在条目超上限时会整体清空，内存有界。
  if (!ttMap) ttMap = new Map();
  if (!historyTable) historyTable = [new Int32Array(361), new Int32Array(361)];
  if (!killerTable) killerTable = Array.from({ length: 12 }, () => [null, null]);
  boardHash = 0;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) hashXor(r, c, board[r][c]);
    }
  }
}

/** 把 (r,c) 处的 color 棋从棋盘哈希中异或进/出（落子与悔棋各调用一次） */
function hashXor(r, c, color) {
  if (!ttZobrist) return;
  boardHash ^= ttZobrist[r][c][color === BLACK ? 0 : 1];
}

/** 写置换表：窗口过窄会存 LOWER/UPPER，完整搜索存 EXACT */
function ttStore(key, depth, flag, val) {
  if (!ttMap) return;
  if (ttMap.size >= TT_MAX_ENTRIES) ttMap.clear();   // 超上限直接清空，简单防内存膨胀
  ttMap.set(key, { depth, flag, val });
}

/**
 * Alpha-Beta 剪枝搜索（困难档核心）。
 * 思路：轮流假设 AI（取最大）与玩家（取最小）落子，向前看 searchDepth 决定的层数，
 * 用 alpha/beta 剪掉不可能影响结果的子树；配合置换表（缓存重复局面）与
 * 历史启发（好手优先尝试），同一预算能搜得更深。超预算时截断为静态评估。 */
function minimax(depth, alpha, beta, isMax, me = aiColor, opp = playerColor) {
  // 超时保护：预算耗尽后直接返回静态评估，保证 19 路棋盘下不卡顿
  if (searchState && performance.now() - searchState.t0 > searchState.budget) {
    return evaluateBoard(me, opp, 1, isMax ? me : opp);
  }
  // 置换表查表：同一局面（含“轮到谁”“搜索视角”）的搜索结果直接复用。
  // 迭代加深会反复展开同一局面，命中后能省掉整棵子树的重算。
  // 视角 XOR：评估分以 me 为正（AI 执黑与教学推荐玩家时的正负方向相反），
  // 不加视角会把两个方向的分数混用导致误判；加上后两者各自独立缓存。
  const ttKey = boardHash ^ (isMax ? TT_SIDE_ME : TT_SIDE_OPP)
              ^ (me === BLACK ? TT_PERSP_BLACK : TT_PERSP_WHITE);
  const entry = ttMap && ttMap.get(ttKey);
  if (entry && entry.depth >= depth) {
    if (entry.flag === TT_EXACT) return entry.val;
    if (entry.flag === TT_LOWER && entry.val >= beta) return entry.val;
    if (entry.flag === TT_UPPER && entry.val <= alpha) return entry.val;
  }
  const alphaOrig = alpha;
  const betaOrig = beta;
  // 任一方向存在一步成五 → 立即返回必胜/必败分，无需继续搜索
  if (findImmediateWin(me)) return WIN_SCORE;
  if (findImmediateWin(opp)) return -WIN_SCORE;
  if (depth === 0) return evaluateBoard(me, opp, 1, isMax ? me : opp);

  // ===== 威胁感知的候选生成（强制走法剪枝） =====
  // 五子棋的胜负由“活四/冲四”这类强制威胁驱动：一旦某方存在冲四级威胁，
  // 对方只能被迫回应。因此在搜索节点先判断双方威胁，把候选收窄到：
  //   ① 对方可一手成活四/成五 → 必须优先堵（除非自己能抢先活四/成五）；
  //   ② 自己能形成冲四级威胁 → 只搜这些强制点（等于把 VCF 思路融进搜索，
  //      分支数从十几个降到几个，同一预算下能顺着杀棋链多看 2~3 层）；
  //   ③ 否则才回落到常规候选（棋子周围 radius 2 内的启发式选点）。
  const side = isMax ? me : opp;                // 本节点行动方
  const oppSide = isMax ? opp : me;             // 对方下一步行动方
  const myDanger = forcingMovesOf(side, 3);     // 自己一手成活四/成五的点
  const oppDanger = forcingMovesOf(oppSide, 3); // 对方一手成活四/成五的点
  let moves;
  if (oppDanger.length && !myDanger.length) {
    moves = oppDanger;                          // 对方威胁更急：必须先堵
  } else if (myDanger.length) {
    moves = myDanger;                           // 自己能活四/成五：无解进攻优先
  } else {
    // 只有“一手形成双威胁”的冲四才是真正强制手（对方一手堵不完）；
    // 单一冲四会被对方一手堵死，若强制只搜它，AI 会盲目冲四挥霍机会——
    // 普通冲四放回常规候选（getCandidateMoves 仍按启发式把冲四点排得很前）。
    const myForcing = forcingMovesOf(side, 2).filter(([r, c]) => countThreats(r, c, side) >= 2);
    moves = myForcing.length ? myForcing : getCandidateMoves(CANDIDATE_LIMIT, side);
  }
  moves = moves.slice(0, CANDIDATE_LIMIT);      // 仍然限宽，控制分支因子
  // 历史启发：把此前“引发剪枝/拿到高分”的落点提前尝试，让剪枝更早发生。
  // 开局阶段历史分全为 0，排序保持原启发式顺序（Array.sort 稳定）。
  if (historyTable) {
    const hArr = historyTable[side === BLACK ? 0 : 1];
    moves.sort((a, b) => hArr[b[0] * 19 + b[1]] - hArr[a[0] * 19 + a[1]]);
  }
  // killer move：把“同剩余深度曾引发剪枝”的落点再提到历史排序之前（标准杀手启发，
  // 比历史启发更“当下”——同一深度的不同分支大概率共享同一步好棋）。只调整既有
  // 候选的顺序、不新增落点，因此强制走法列表也不会被破坏。
  if (killerTable && killerTable[depth]) {
    for (let k = 0; k < 2; k++) {
      const km = killerTable[depth][k];
      if (!km) continue;
      const ki = moves.findIndex(mv => mv[0] === km[0] && mv[1] === km[1]);
      if (ki > 0) { moves.splice(ki, 1); moves.unshift([km[0], km[1]]); }
    }
  }
  if (moves.length === 0) { ttStore(ttKey, depth, TT_EXACT, 0); return 0; }  // 无子可下（平局）
  if (isMax) {                                       // 我方回合：取最大
    let best = -Infinity;
    for (const [r, c] of moves) {
      board[r][c] = me;
      hashXor(r, c, me);
      const v = minimax(depth - 1, alpha, beta, false, me, opp);
      hashXor(r, c, me);
      board[r][c] = EMPTY;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (beta <= alpha) {                           // 剪枝：这手证明有效，历史加分并记入杀手表
        if (historyTable) historyTable[0][r * 19 + c] += depth * depth;
        if (killerTable && killerTable[depth]) {
          const kl = killerTable[depth];
          if (!(kl[0] && kl[0][0] === r && kl[0][1] === c)) { kl[1] = kl[0]; kl[0] = [r, c]; }
        }
        break;
      }
    }
    ttStore(ttKey, depth, best <= alphaOrig ? TT_UPPER : (best >= betaOrig ? TT_LOWER : TT_EXACT), best);
    return best;
  } else {                                           // 对方回合：取最小
    let best = Infinity;
    for (const [r, c] of moves) {
      board[r][c] = opp;
      hashXor(r, c, opp);
      const v = minimax(depth - 1, alpha, beta, true, me, opp);
      hashXor(r, c, opp);
      board[r][c] = EMPTY;
      if (v < best) best = v;
      if (v < beta) beta = v;
      if (beta <= alpha) {                           // 剪枝：对方这手让己方无望，同样加分并记入杀手表
        if (historyTable) historyTable[1][r * 19 + c] += depth * depth;
        if (killerTable && killerTable[depth]) {
          const kl = killerTable[depth];
          if (!(kl[0] && kl[0][0] === r && kl[0][1] === c)) { kl[1] = kl[0]; kl[0] = [r, c]; }
        }
        break;
      }
    }
    ttStore(ttKey, depth, best <= alphaOrig ? TT_UPPER : (best >= betaOrig ? TT_LOWER : TT_EXACT), best);
    return best;
  }
}

/**
 * 收集 color 一步即可形成“冲四级以上威胁”（minLv=2 冲四 / minLv=3 活四 / 成五）的空位。
 * 用于强制走法搜索：这类点落子后对方必须回应，是五子棋的“强制手”。
 * @param {number} color 行动方颜色
 * @param {number} [minLv] 最低威胁等级（默认 2）
 * @returns {Array<Array<number>>} [r, c] 列表
 */
function forcingMovesOf(color, minLv = 2) {
  const pts = [];
  const seen = new Set();
  // 冲四/活四/成五的落点必然落在同色连线的 5 格窗口内，即紧邻同色棋子（半径 2 内）。
  // 只扫描同色棋子周围 2 格的空位，把每个搜索节点的开销从“全盘 361 格 × threatLevel”
  // 降到局部候选——这是困难档中后盘提速的关键（minimax 每个节点都要调两次）。
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== color) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr, nc = c + dc;
          if (!inBoard(nr, nc) || board[nr][nc] !== EMPTY) continue;
          const key = nr * boardSize + nc;
          if (seen.has(key)) continue;
          seen.add(key);
          // threatLevel 对“成五”返回 4，天然 >= minLv，无需单独调 canWinNow
          if (threatLevel(nr, nc, color) >= minLv) pts.push([nr, nc]);
        }
      }
    }
  }
  return pts;
}

/**
 * 动态搜索深度：根据盘面棋子数自动加深层数，兼顾速度与“快点赢”。
 * 开局/中盘候选点多，保持 3 层保证响应速度（约 <1s）；
 * 中后盘与残局时棋子密集、候选点变少，搜索树天然缩小。
 * 借助置换表/历史启发压住重复展开后，可放心加深到 5~6 层，
 * 让 AI 看穿更长的杀棋链条，尽早兑现优势、避免拖到百步。
 * @returns {number} 本次搜索使用的深度 */
function searchDepth() {
  let placed = 0;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (board[r][c] !== EMPTY) placed++;
    }
  }
  if (placed >= 60) return 6;   // 残局后期：候选点很少，可放心加深到 6 层
  if (placed >= 35) return 5;   // 中后盘：候选点已收敛，加深两层尽早兑现优势
  return 3;                     // 开局/中盘：候选点多，保持 3 层控制耗时
}

/** 困难档入口：在根节点对每个候选落子模拟一步，再递归搜索并选最优 */
/**
 * 困难档搜索入口：迭代加深 + Alpha-Beta。
 * 先搜 3 层拿到基准结果，预算内继续加深到 5~6 层（searchDepth 按残局进度定上限）。
 * 时间不够就用已完成的最深一层结果；配合置换表与历史启发，同一预算能搜得更深。
 * @param {string} [level] 当前难度，仅用于兜底打分时的随机候选数
 */
function bestBySearch(me = aiColor, opp = playerColor, level, budgetMs = SEARCH_BUDGET_MS, depthLimit = 0) {
  // 重建棋盘哈希（ttMap/historyTable/killerTable 跨步持续复用，见 initSearchTables）
  initSearchTables();
  // 根节点同样先做必杀检测（能赢立刻赢、该挡立刻挡）
  const aiWin = findImmediateWin(me);
  if (aiWin) return aiWin;
  const playerWin = findImmediateWin(opp);
  if (playerWin) return playerWin;
  // 对方存在一手成双杀的隐患 → 先堵（无更强即时威胁时）
  const oppDt = findOpponentDoubleThreat(opp);
  if (oppDt) {
    const urgent = resolveThreats(me, opp, true);
    if (urgent) return urgent;
    return oppDt;
  }

  searchState = { t0: performance.now(), budget: budgetMs };
  // 根候选（启发式排序），并记录原始下标：跨步置换表会让“第二次搜索”更快、
  // 更早知道更多必胜手，并列分数必须按原始候选顺序打破，结果才与缓存状态无关。
  let ordered = getCandidateMoves(ROOT_CANDIDATE_LIMIT, me).map((m, i) => ({ r: m[0], c: m[1], idx: i }));
  if (ordered.length === 0) return null;

  // 按残局进度自动加深（searchDepth），depthLimit>0 时封顶（中等档固定 3 层）
  const maxDepth = depthLimit > 0 ? Math.min(depthLimit, searchDepth()) : searchDepth();
  const startDepth = Math.min(3, maxDepth);   // 至少从 3 层起搜
  let bestMove = null;
  let bestScore = -Infinity;
  outer:
  for (let depth = startDepth; depth <= maxDepth; depth++) {
    // 分层时间盒：浅层保证完成，深层用剩余预算。深层超时立即采用“已完成/部分完成”
    // 的结果——旧逻辑会把整个预算耗在做不完的深层上，等满预算却只拿到浅层结果。
    const levelBudget = Math.max(150,
      (searchState.budget - (performance.now() - searchState.t0)) / (maxDepth - depth + 1));
    const levelStart = performance.now();
    let dBest = null;
    let dBestIdx = Infinity;
    let dScore = -Infinity;
    const scored = [];
    let levelDone = true;
    for (const { r, c, idx } of ordered) {
      if (performance.now() - searchState.t0 > searchState.budget) { levelDone = false; break; }
      if (performance.now() - levelStart > levelBudget) { levelDone = false; break; }
      board[r][c] = me;
      hashXor(r, c, me);           // 根节点也维护棋盘哈希，让置换表覆盖整棵子树
      const v = minimax(depth - 1, -Infinity, Infinity, false, me, opp);
      hashXor(r, c, me);
      board[r][c] = EMPTY;
      scored.push({ r, c, idx, v });
      // 分数更高才换；同分取“原始候选顺序更靠前”的，保证确定性与缓存无关
      if (v > dScore || (v === dScore && idx < dBestIdx)) {
        dScore = v;
        dBest = [r, c];
        dBestIdx = idx;
      }
      // 根节点已确认必杀（我们下完这手，对方无论如何都挡不住成五）：
      // 立刻收手落子，不再把预算浪费在已经赢定的局面上。
      if (v >= WIN_SCORE) return [r, c];
    }
    if (dBest) { bestMove = dBest; bestScore = dScore; }   // 这一层（或部分）完成，保留结果
    if (!levelDone) break;                                // 超时：采用已有结果
    // 根候选排序：按本层得分降序重排（同分保持原始顺序），让“疑似最优”在
    // 下一层先试，第一手就能撑起更紧的 alpha 窗口，剪枝更早发生。
    scored.sort((a, b) => b.v - a.v || a.idx - b.idx);
    ordered = scored.map(s => ({ r: s.r, c: s.c, idx: s.idx }));
  }
  return bestMove || bestByScore(me, opp, level);  // 兜底：搜索失败时退回单步打分
}

/* ---------------- 四、开局库（由生成器从既有模块取出；outputs/engine/opening-book.json 为可读副本） ---------------- */
/* 覆盖 0~8 子（前 9 手）：key = 轮到方(B/W) + '|' + 8 对称规范化后的棋子相对坐标串；
 * 应答为 [相对行, 相对列, 权重 5~1]，相对坐标以天元为中心。完整说明见 gomoku.html 原注释。 */
const OPENING_BOOK = {"B|":[[0,0,5]],"W|0,0,1":[[-1,0,5],[0,-1,4],[0,1,3],[1,0,2],[-1,-1,1]],"B|-1,0,2;0,0,1":[[-1,-1,5],[-1,1,4],[1,-1,3],[1,1,2],[0,-1,1]],"W|-1,-1,1;-1,0,2;0,0,1":[[1,1,5],[-2,-2,4],[0,-1,3],[0,1,2]],"B|-1,-1,1;-1,0,2;0,0,1;1,1,2":[[0,-1,5],[1,-1,4],[0,-2,3]],"W|-1,-1,1;-1,0,1;0,-1,2;0,0,1;1,1,2":[[1,0,5],[-1,-2,4],[-1,1,3]],"B|-1,-1,1;-1,0,1;0,-1,2;0,0,1;1,0,2;1,1,2":[[-1,-2,5],[2,1,4],[1,2,3]],"W|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,0,1;1,1,1;1,2,1":[[1,-1,5],[1,3,4],[-1,1,3]],"B|-1,-1,2;-1,0,1;-1,1,1;-1,2,1;0,0,1;0,1,2;1,-1,2;1,0,2":[[-1,3,5],[-1,4,4],[-2,0,3]],"W|-1,-1,1;-1,0,1;0,-1,2;0,0,1;1,0,2;1,1,2;2,1,1":[[1,2,5],[1,-1,4],[-1,-2,3]],"B|-1,-1,1;-1,0,1;0,-1,2;0,0,1;1,0,2;1,1,2;1,2,2;2,1,1":[[1,-1,5],[1,3,4],[-1,1,3]],"B|-1,-1,2;0,0,1;0,1,1;1,0,2;1,1,1;2,1,2":[[0,-1,5],[-1,-2,4],[-2,-1,3]],"W|-1,-1,2;-1,0,1;0,0,1;0,1,2;1,0,1;1,1,1;1,2,2":[[2,0,5],[-2,0,4],[0,-1,3]],"B|-1,-1,2;-1,0,1;0,0,1;0,1,2;1,0,1;1,1,1;1,2,2;2,0,2":[[-2,0,5],[1,-1,4],[2,2,3]],"W|-1,-2,1;-1,-1,2;0,0,1;0,1,1;1,0,2;1,1,1;2,1,2":[[0,-1,5],[0,2,4],[0,-2,3]],"B|-1,-2,1;-1,-1,2;0,-1,2;0,0,1;0,1,1;1,0,2;1,1,1;2,1,2":[[4,3,5],[3,2,4],[-2,-1,3]],"B|-1,-1,1;-1,0,1;-1,1,2;0,-1,2;0,0,1;1,1,2":[[-2,0,5],[1,0,4],[0,1,3]],"W|-1,-1,1;-1,0,2;0,-2,1;0,-1,1;0,0,1;1,-1,2;1,1,2":[[0,1,5],[0,-3,4],[1,0,3]],"B|-1,-1,1;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-1,2;1,1,2":[[0,-3,5],[1,-3,4],[-2,0,3]],"W|-1,-1,1;-1,0,1;-1,1,2;0,-1,2;0,0,1;1,0,1;1,1,2":[[-2,0,5],[2,0,4],[0,1,3]],"B|-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,1;1,-1,2;1,1,2":[[0,2,5],[1,0,4],[-1,-3,3]],"W|-1,-1,1;-1,0,2;0,0,1;1,-1,1;1,1,2":[[-1,1,5],[0,-1,4],[0,1,3]],"B|-1,-1,1;-1,0,2;-1,1,2;0,0,1;1,-1,1;1,1,2":[[0,-1,5],[2,-1,4],[-2,1,3]],"W|-1,-1,1;-1,0,1;-1,1,1;0,-1,2;0,0,1;1,-1,2;1,1,2":[[-1,-2,5],[-1,2,4],[1,0,3]],"B|-1,-1,1;-1,0,1;-1,1,1;-1,2,2;0,0,1;0,1,2;1,-1,2;1,1,2":[[1,0,5],[-1,-2,4],[0,-2,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,0,1;1,-1,1;1,1,2;2,-1,1":[[0,-1,5],[0,1,4],[3,-1,3]],"B|-1,-1,1;-1,0,2;-1,1,1;-1,2,1;0,-1,2;0,0,1;1,-1,2;1,1,2":[[1,-2,5],[0,2,4],[-2,1,3]],"B|-1,-1,1;-1,0,2;-1,1,1;0,-1,2;0,0,1;1,1,2":[[-2,2,5],[1,-1,4],[-2,1,3]],"W|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-1,1;1,1,2;2,-2,1":[[3,-3,5],[-1,1,4],[1,-2,3]],"B|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-1,1;1,1,2;2,-2,1;3,-3,2":[[-1,1,5],[1,-2,4],[2,-1,3]],"W|-1,-1,1;-1,0,2;-1,1,1;0,-1,2;0,0,1;1,-1,1;1,1,2":[[-2,2,5],[2,-2,4],[-2,1,3]],"B|-1,-1,1;-1,0,2;-1,1,1;0,-1,2;0,0,1;1,-1,1;1,1,2;2,-2,2":[[-2,2,5],[1,-2,4],[-2,1,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,-1,1;1,1,2":[[-1,1,5],[2,-1,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;-1,1,1;0,-1,2;0,0,1;1,-1,2;1,1,1":[[-2,-2,5],[2,2,4],[1,-2,3]],"B|-1,-1,1;-1,1,1;0,-1,2;0,0,1;1,-1,1;1,0,2;1,1,2;2,-2,2":[[-2,2,5],[-1,-2,4],[-1,2,3]],"W|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,-1,1;1,1,2;2,-1,1":[[-2,-1,5],[0,-1,4],[-1,1,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,-2,1;1,-1,1;1,1,1;1,2,2":[[1,0,5],[1,-3,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;0,-2,1;0,0,1;1,1,2":[[0,1,5],[0,-1,4],[-2,-1,3]],"B|-1,-1,1;-1,0,2;0,-2,1;0,0,1;0,1,2;1,1,2":[[1,-3,5],[-2,0,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;0,-2,1;0,0,1;0,1,2;1,-3,1;1,1,2":[[2,-4,5],[-2,0,4],[1,2,3]],"B|-1,-1,1;-1,0,2;0,-2,1;0,0,1;0,1,2;1,-3,1;1,1,2;2,-4,2":[[-2,0,5],[-2,-1,4],[1,2,3]],"W|-1,-1,2;-1,0,2;0,0,1;0,1,2;0,2,1;1,1,1;2,0,1":[[-1,3,5],[3,-1,4],[1,2,3]],"B|-1,-1,2;-1,0,2;-1,3,2;0,0,1;0,1,2;0,2,1;1,1,1;2,0,1":[[3,-1,5],[-1,1,4],[-1,2,3]],"B|-1,-1,1;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,1,2":[[1,-3,5],[-2,0,4],[1,-2,3]],"W|-1,-1,1;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-3,1;1,1,2":[[2,-4,5],[-2,0,4],[1,-2,3]],"B|-1,-1,1;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-3,1;1,1,2;2,-4,2":[[-2,0,5],[1,-2,4],[0,-3,3]],"W|-1,-1,2;0,0,1;0,1,2;0,2,1;1,0,2;1,1,1;2,0,1":[[3,-1,5],[-1,3,4],[2,-1,3]],"B|-1,-1,2;-1,3,2;0,0,1;0,1,2;0,2,1;1,0,2;1,1,1;2,0,1":[[3,-1,5],[-1,2,4],[2,-1,3]],"B|-1,-1,2;0,0,1;0,1,2;1,1,1;1,2,2;2,0,1":[[0,2,5],[3,-1,4],[3,0,3]],"W|-1,-1,2;0,0,1;0,1,2;0,2,1;1,1,1;1,2,2;2,0,1":[[-1,3,5],[3,-1,4],[-1,0,3]],"B|-1,-1,2;-1,3,2;0,0,1;0,1,2;0,2,1;1,1,1;1,2,2;2,0,1":[[3,-1,5],[-1,0,4],[3,0,3]],"W|-1,-1,2;-1,3,1;0,0,1;0,2,1;1,0,2;1,1,1;2,1,2":[[2,0,5],[-2,4,4],[0,-1,3]],"B|-1,-1,2;-1,3,1;0,0,1;0,2,1;1,0,2;1,1,1;2,0,2;2,1,2":[[-2,4,5],[0,-1,4],[0,3,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;0,0,1":[[0,-1,5],[0,-2,4],[1,-1,3]],"W|-2,-2,2;-1,-1,1;-1,0,1;0,-1,2;0,0,1":[[1,0,5],[-1,-2,4],[-2,0,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-1,1;1,0,1;2,-2,2":[[1,-2,5],[-2,1,4],[-1,1,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-2,1;1,-1,1;1,0,1;2,-2,2":[[1,1,5],[1,-3,4],[2,-1,3]],"B|-1,-1,2;0,-1,1;0,0,1;0,1,2;1,-1,1;1,0,2;2,-2,2;2,-1,1":[[3,-1,5],[0,-2,4],[-1,1,3]],"W|-1,-2,1;0,-1,2;0,0,1;0,1,1;1,0,2;1,1,1;2,2,2":[[2,1,5],[3,2,4],[-1,0,3]],"B|-1,-2,1;0,-1,2;0,0,1;0,1,1;1,0,2;1,1,1;2,1,2;2,2,2":[[3,2,5],[2,0,4],[2,3,3]],"B|-2,-2,2;-1,-2,2;-1,-1,1;-1,0,1;0,-1,2;0,0,1":[[1,0,5],[-2,0,4],[-1,1,3]],"W|-1,0,1;0,-1,2;0,0,1;1,-2,2;1,-1,1;1,0,1;2,-2,2":[[2,0,5],[-2,0,4],[0,-2,3]],"B|-1,0,1;0,-1,2;0,0,1;1,-2,2;1,-1,1;1,0,1;2,-2,2;2,0,2":[[-2,0,5],[1,1,4],[2,-1,3]],"W|-2,-2,2;-2,-1,2;-1,-1,1;-1,0,2;0,-2,1;0,-1,1;0,0,1":[[0,1,5],[0,-3,4],[-2,0,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-2,2;1,-1,1;1,0,1;2,-2,2;2,0,1":[[3,0,5],[2,-3,4],[-2,1,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[1,-1,5],[-2,-1,4],[-1,-2,3]],"W|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-1,1;1,0,2;2,-2,2":[[2,-1,5],[-2,-1,4],[1,-2,3]],"B|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-1,1;1,0,2;2,-2,2;2,-1,2":[[-2,-1,5],[-2,-2,4],[1,1,3]],"W|-2,-2,2;-2,-1,1;-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[1,-1,5],[-3,-1,4],[-1,-2,3]],"B|-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,-1,1;1,0,2;2,-2,2;2,-1,1":[[3,-1,5],[4,-1,4],[1,-2,3]],"W|-2,-2,2;-1,-1,1;-1,0,2;0,-2,1;0,0,1":[[-2,0,5],[0,-1,4],[0,1,3]],"B|-2,-2,2;-2,0,1;-1,-1,1;0,-2,2;0,-1,2;0,0,1":[[-1,0,5],[-3,0,4],[-1,-2,3]],"W|-2,-2,2;-2,0,1;-1,-1,1;-1,0,1;0,-2,2;0,-1,2;0,0,1":[[1,0,5],[-3,0,4],[-1,-2,3]],"B|-1,0,2;0,-2,2;0,-1,2;0,0,1;1,-1,1;1,0,1;2,-2,2;2,0,1":[[1,-2,5],[3,0,4],[3,-1,3]],"W|-2,-2,2;-2,0,2;-1,-1,1;-1,0,2;0,-3,1;0,-2,1;0,0,1":[[0,-1,5],[-2,-1,4],[0,-4,3]],"B|-2,-2,2;-2,0,2;-1,-1,1;-1,0,2;0,-3,1;0,-2,1;0,-1,2;0,0,1":[[1,-2,5],[-2,1,4],[1,-3,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;0,-2,1;0,-1,2;0,0,1":[[1,-3,5],[-2,0,4],[1,-2,3]],"W|-1,-3,1;0,-2,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,2":[[-2,-4,5],[2,0,4],[-1,-2,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-3,1;2,-4,2":[[-2,0,5],[1,-2,4],[0,-3,3]],"W|-2,-2,2;-2,0,1;-1,-1,1;-1,0,2;0,-2,1;0,-1,2;0,0,1":[[-3,1,5],[1,-3,4],[-2,1,3]],"B|-1,-3,2;0,-2,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,2;2,0,1":[[3,1,5],[-1,-2,4],[2,1,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-1,1;2,-2,2;2,0,1":[[3,1,5],[0,-2,4],[1,-2,3]],"W|-1,-3,1;0,-2,1;0,0,1;0,1,2;1,-1,1;1,0,2;2,-2,2":[[-2,-4,5],[2,0,4],[2,-1,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-1,1;2,-2,2;2,0,1;3,1,1;4,2,2":[[0,-2,5],[1,-2,4],[-2,1,3]],"W|-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-1,1;2,-2,2;2,0,1":[[-1,-3,5],[3,1,4],[1,-2,3]],"B|-1,-3,2;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-1,1;2,-2,2;2,0,1":[[3,1,5],[1,-2,4],[-1,1,3]],"W|-1,-1,1;0,0,1;1,-1,1;1,0,2;2,-2,2":[[2,-1,5],[0,-1,4],[0,1,3]],"B|-1,-1,1;0,0,1;1,-1,1;1,0,2;2,-2,2;2,-1,2":[[-2,-2,5],[1,1,4],[0,1,3]],"W|-2,-2,1;-1,-1,1;0,0,1;1,-1,1;1,0,2;2,-2,2;2,-1,2":[[-3,-3,5],[1,1,4],[3,-2,3]],"B|-2,-2,2;-2,-1,2;-1,-1,1;-1,0,2;0,0,1;1,-1,1;2,-2,1;3,-3,2":[[-1,1,5],[0,1,4],[-2,0,3]],"W|-1,-1,1;0,-1,2;0,0,1;1,-2,2;1,-1,1;1,1,1;2,-2,2":[[-2,-2,5],[2,2,4],[-1,0,3]],"B|-1,-1,1;0,0,1;1,-1,1;1,0,2;1,1,1;2,-2,2;2,-1,2;2,2,2":[[-2,-2,5],[2,0,4],[2,1,3]],"B|-1,-1,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,2":[[-2,-2,5],[1,1,4],[-1,-2,3]],"W|-2,-2,1;-1,-1,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,2":[[-3,-3,5],[1,1,4],[-1,-2,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-1,1;2,-2,1;3,-3,2":[[-1,1,5],[1,-2,4],[2,-1,3]],"W|-1,-1,1;0,-1,2;0,0,1;1,-1,1;1,0,2;1,1,1;2,-2,2":[[-2,-2,5],[2,2,4],[-1,-2,3]],"B|-1,-1,1;0,-1,2;0,0,1;1,-1,1;1,0,2;1,1,1;2,-2,2;2,2,2":[[-2,-2,5],[2,1,4],[-1,-2,3]],"B|-1,-1,1;0,0,1;0,1,2;1,-1,1;1,0,2;2,-2,2":[[1,1,5],[-2,-2,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-1,1;1,1,1;2,-2,2":[[-2,-2,5],[2,2,4],[1,-2,3]],"B|-1,-1,1;0,0,1;0,1,2;1,-1,1;1,0,2;1,1,1;2,-2,2;2,2,2":[[-2,-2,5],[2,-1,4],[-2,-1,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-1,1;1,1,1;2,-2,2;2,2,1":[[-1,-1,5],[3,3,4],[1,-2,3]],"B|-1,-1,2;-1,0,2;0,-1,2;0,0,1;1,-1,1;1,1,1;2,-2,2;2,2,1":[[3,3,5],[1,-2,4],[1,2,3]],"B|-1,-1,1;-1,0,2;0,-1,2;0,0,1":[[-2,-2,5],[1,1,4],[-2,1,3]],"W|-2,-2,1;-1,-1,1;-1,0,2;0,-1,2;0,0,1":[[-3,-3,5],[1,1,4],[-2,1,3]],"B|-3,-3,2;-2,-2,1;-1,-1,1;-1,0,2;0,-1,2;0,0,1":[[1,1,5],[-2,1,4],[1,-2,3]],"W|-1,-1,1;0,0,1;0,1,2;1,0,2;1,1,1;2,2,1;3,3,2":[[-2,-2,5],[2,-1,4],[-1,2,3]],"B|-2,-2,2;-1,-1,1;0,0,1;0,1,2;1,0,2;1,1,1;2,2,1;3,3,2":[[2,-1,5],[-1,2,4],[0,-1,3]],"W|-1,-2,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,1;3,-3,2":[[-1,1,5],[2,-3,4],[3,-2,3]],"B|-1,-1,2;-1,2,1;0,0,1;0,1,2;1,0,2;1,1,1;2,2,1;3,3,2":[[0,2,5],[-2,2,4],[-1,3,3]],"B|-1,-1,2;0,0,1;0,1,2;1,0,2;1,1,1;2,2,1":[[3,3,5],[2,-1,4],[-1,2,3]],"W|-1,-1,2;0,0,1;0,1,2;1,0,2;1,1,1;2,2,1;3,3,1":[[4,4,5],[2,-1,4],[-1,2,3]],"B|-1,-1,2;0,0,1;0,1,2;1,0,2;1,1,1;2,2,1;3,3,1;4,4,2":[[3,2,5],[2,3,4],[2,-1,3]],"W|-1,-1,2;-1,2,1;0,0,1;0,1,2;1,0,2;1,1,1;2,2,1":[[3,3,5],[0,-1,4],[-1,0,3]],"B|-1,-2,2;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,1":[[3,-3,5],[-1,1,4],[-2,-3,3]],"W|-1,-2,2;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,1;3,-3,1":[[-2,-3,5],[2,1,4],[4,-4,3]],"B|-2,-3,2;-1,-2,2;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,1;3,-3,1":[[4,-4,5],[-1,1,4],[-3,-4,3]],"W|-1,-1,1;-1,2,2;0,0,1;0,1,2;1,0,2;1,1,1;2,2,1":[[-2,3,5],[2,-1,4],[3,3,3]],"B|-1,-1,1;0,0,1;0,1,2;1,0,2;1,1,1;2,-1,2;2,2,1;3,-2,2":[[3,3,5],[-2,-2,4],[4,-3,3]],"W|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,1,1":[[-2,-2,5],[2,2,4],[-2,1,3]],"B|-1,-1,1;0,0,1;0,1,2;1,0,2;1,1,1;2,2,2":[[-2,-2,5],[2,-1,4],[-1,2,3]],"W|-2,-2,1;-1,-1,1;0,0,1;0,1,2;1,0,2;1,1,1;2,2,2":[[-3,-3,5],[2,-1,4],[-1,2,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,1,1;2,2,1;3,3,2":[[1,2,5],[2,1,4],[-2,1,3]],"W|-1,-1,1;-1,2,1;0,0,1;0,1,2;1,0,2;1,1,1;2,2,2":[[-2,-2,5],[2,1,4],[1,2,3]],"B|-2,-1,1;-2,2,2;-1,0,2;-1,1,1;0,0,1;0,1,2;1,-1,1;2,-2,2":[[-1,-1,5],[-3,-1,4],[-2,-2,3]],"B|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,1,1;2,2,2":[[-2,-2,5],[-2,1,4],[1,-2,3]],"W|-2,-2,1;-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,1,1;2,2,2":[[-3,-3,5],[-2,1,4],[1,-2,3]],"W|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-2,1;1,1,1;2,2,2":[[-2,-2,5],[2,1,4],[1,2,3]],"B|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-2,2;1,1,1":[[-2,-2,5],[2,2,4],[2,-3,3]],"W|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-2,2;1,1,1;2,2,1":[[2,-3,5],[-2,1,4],[-2,-2,3]],"B|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-2,2;1,1,1;2,-3,2;2,2,1":[[-2,-2,5],[3,3,4],[3,-4,3]],"W|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-2,1":[[1,1,5],[-2,-1,4],[-1,-2,3]],"B|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-2,1;1,1,2":[[1,-3,5],[0,-2,4],[1,-1,3]],"W|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-3,1;1,-2,1;1,1,2":[[0,-2,5],[1,-4,4],[-2,1,3]],"B|-1,-1,1;-1,0,2;0,-2,2;0,-1,2;0,0,1;1,-3,1;1,-2,1;1,1,2":[[1,-4,5],[-2,-2,4],[1,-1,3]],"W|-1,-1,1;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-2,1;1,1,2":[[1,-3,5],[-2,1,4],[-1,-2,3]],"B|-1,-1,1;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-3,2;1,-2,1;1,1,2":[[2,-2,5],[-1,-2,4],[-2,-2,3]],"B|-1,-2,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-1,2":[[2,-2,5],[-1,1,4],[0,-2,3]],"W|-1,-2,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,1;2,-1,2":[[3,-3,5],[-1,1,4],[3,-2,3]],"B|-1,-2,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,1;2,-1,2;3,-3,2":[[-1,1,5],[3,-2,4],[1,-2,3]],"W|-1,-1,1;-1,2,1;0,0,1;0,1,2;1,0,2;1,1,1;2,1,2":[[2,2,5],[-2,-2,4],[0,-1,3]],"B|-1,-1,1;-1,2,1;0,0,1;0,1,2;1,0,2;1,1,1;2,1,2;2,2,2":[[-2,-2,5],[-1,1,4],[-1,0,3]],"B|-1,-2,1;0,-1,2;0,0,1;1,-2,2;1,-1,1;1,0,2":[[2,-2,5],[-1,1,4],[-1,0,3]],"W|-1,-2,1;0,-1,2;0,0,1;1,-2,2;1,-1,1;1,0,2;2,-2,1":[[3,-3,5],[-1,1,4],[2,-3,3]],"B|-1,-2,1;0,-1,2;0,0,1;1,-2,2;1,-1,1;1,0,2;2,-2,1;3,-3,2":[[-1,1,5],[2,-3,4],[-1,0,3]],"W|-1,-1,1;-1,2,1;0,0,1;0,1,2;1,0,2;1,1,1;1,2,2":[[2,2,5],[-2,-2,4],[-1,0,3]],"B|-1,-1,1;-1,2,1;0,0,1;0,1,2;1,0,2;1,1,1;1,2,2;2,2,2":[[-2,-2,5],[-1,0,4],[2,3,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,2":[[1,1,5],[-2,-2,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,1,1":[[-2,-2,5],[2,2,4],[-2,-1,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,1,1;2,2,2":[[-2,-2,5],[1,2,4],[-2,-1,3]],"W|-2,-2,1;-1,-1,1;-1,0,2;0,0,1;0,1,2;1,1,1;2,2,2":[[-3,-3,5],[1,2,4],[-2,-1,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;0,0,1;0,1,2;1,1,1;2,2,1;3,3,2":[[1,2,5],[2,1,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,1,1;1,2,1;2,2,2":[[-2,-2,5],[1,3,4],[1,0,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;0,0,1;0,1,2;1,1,1;1,2,1;2,2,2":[[1,3,5],[1,0,4],[-1,1,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,1,1;1,2,2":[[2,2,5],[-2,-2,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,1,1;1,2,2;2,2,1":[[2,3,5],[-2,-1,4],[3,3,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,1,1;1,2,2;2,2,1;2,3,2":[[3,3,5],[-2,-2,4],[-2,-1,3]],"W|-1,-2,2;-1,-1,1;0,-1,2;0,0,1;1,0,2;1,1,1;2,2,1":[[2,1,5],[-2,-3,4],[3,2,3]],"B|-1,-2,2;-1,-1,1;0,-1,2;0,0,1;1,0,2;1,1,1;2,1,2;2,2,1":[[-2,-2,5],[3,3,4],[3,2,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-1,1;2,-2,1":[[-1,1,5],[3,-3,4],[1,-2,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,1,1;2,2,1":[[3,3,5],[1,2,4],[-1,1,3]],"W|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,1,1;2,2,1;3,3,1":[[4,4,5],[1,2,4],[-2,-1,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,1,1;2,2,1;3,3,1;4,4,2":[[1,2,5],[-1,1,4],[-2,-1,3]],"W|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,1,1;1,2,1;2,2,1":[[-1,-2,5],[-1,2,4],[-1,1,3]],"B|-1,-2,2;-1,-1,2;-1,0,2;0,0,1;0,1,2;1,1,1;1,2,1;2,2,1":[[3,3,5],[-1,1,4],[-1,-3,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-1,1;2,-2,1;3,-3,2":[[-1,1,5],[1,-2,4],[2,-1,3]],"W|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,1,1;2,2,1;3,3,2":[[-2,-2,5],[1,2,4],[-2,-1,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-2,1;1,-1,1;2,-2,1;3,-3,2":[[-1,1,5],[3,-2,4],[1,0,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,1,1;1,2,1;2,2,1;3,3,2":[[1,3,5],[3,2,4],[1,0,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-2,2;1,-1,1;2,-2,1":[[-1,1,5],[3,-3,4],[2,-3,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-2,2;1,-1,1;2,-2,1;3,-3,1":[[2,-3,5],[-2,1,4],[3,-4,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-2,2;1,-1,1;2,-3,2;2,-2,1;3,-3,1":[[-1,1,5],[4,-4,4],[3,-4,3]],"W|-1,-2,1;-1,-1,1;0,-1,2;0,0,1;1,0,2":[[1,1,5],[-1,0,4],[-2,-2,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,1,1;1,2,1":[[1,0,5],[1,3,4],[0,2,3]],"W|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,1,1;1,2,1;1,3,1":[[1,0,5],[1,4,4],[-1,1,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,0,2;1,1,1;1,2,1;1,3,1":[[1,4,5],[2,0,4],[0,2,3]],"B|-1,-2,1;-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,0,2":[[-2,-2,5],[1,1,4],[1,-2,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-2,1;1,-1,1;1,0,2;2,-2,1":[[-1,1,5],[3,-3,4],[-1,-2,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,0,2;1,1,1;1,2,1;2,2,1":[[3,3,5],[3,2,4],[-1,2,3]],"W|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,0,2;1,1,1;1,2,1":[[2,2,5],[-2,-2,4],[-1,2,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,0,2;1,1,1;1,2,1;2,2,2":[[-2,-2,5],[-1,2,4],[2,-1,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-2,1;1,-1,1;2,-2,2":[[1,-3,5],[1,0,4],[-1,1,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-3,1;1,-2,1;1,-1,1;2,-2,2":[[1,0,5],[1,-4,4],[-1,1,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-3,1;1,-2,1;1,-1,1;1,0,2;2,-2,2":[[1,-4,5],[1,-5,4],[-1,-2,3]],"W|-1,-1,1;0,0,1;0,1,2":[[1,1,5],[-1,0,4],[1,0,3],[-2,-2,2]],"B|-1,-1,1;0,0,1;0,1,2;1,1,2":[[-1,1,5],[-1,0,4],[-2,0,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,0,1;1,-1,1":[[1,1,5],[-2,1,4],[0,-1,3]],"B|-1,-1,1;-1,1,1;0,-1,2;0,0,1;1,-2,2;1,-1,2":[[-1,0,5],[1,1,4],[-2,-2,3]],"W|-1,-1,1;-1,0,1;-1,1,1;0,-1,2;0,0,1;1,-2,2;1,-1,2":[[-1,-2,5],[-1,2,4],[1,0,3]],"B|-1,-1,1;-1,0,1;-1,1,1;-1,2,2;0,0,1;0,1,2;1,1,2;1,2,2":[[1,0,5],[-1,-2,4],[1,-1,3]],"W|-1,-1,1;-1,1,1;0,-1,2;0,0,1;1,-2,2;1,-1,2;1,1,1":[[-2,-2,5],[2,2,4],[-1,0,3]],"B|-1,-1,1;-1,1,1;0,0,1;1,-1,1;1,0,2;1,1,2;2,-2,2;2,1,2":[[-2,2,5],[-1,-2,4],[-1,2,3]],"B|-1,-1,1;-1,0,2;-1,1,1;0,-1,2;0,0,1;1,-1,2":[[-2,-2,5],[1,1,4],[-2,1,3]],"W|-1,-1,1;0,-1,2;0,0,1;1,-1,1;1,0,2;1,1,2;2,-2,1":[[3,-3,5],[-1,1,4],[2,1,3]],"B|-1,-1,1;0,-1,2;0,0,1;1,-1,1;1,0,2;1,1,2;2,-2,1;3,-3,2":[[-1,1,5],[-1,-2,4],[0,-2,3]],"W|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,1,2":[[-1,1,5],[1,0,4],[1,-1,3]],"B|-1,-1,1;-1,0,1;-1,1,2;0,0,1;0,1,2;1,1,2":[[-2,1,5],[2,1,4],[-2,0,3]],"W|-1,-1,1;0,-1,1;0,0,1;1,-2,1;1,-1,2;1,0,2;1,1,2":[[1,2,5],[-1,0,4],[0,1,3]],"B|-1,-1,1;0,-1,1;0,0,1;1,-2,1;1,-1,2;1,0,2;1,1,2;1,2,2":[[1,3,5],[0,-2,4],[0,1,3]],"W|-1,-1,1;-1,0,1;-1,1,2;0,0,1;0,1,2;1,1,2;2,1,1":[[-2,1,5],[-2,0,4],[1,0,3]],"B|-1,-1,1;0,-1,1;0,0,1;1,-2,2;1,-1,2;1,0,2;1,1,2;1,2,1":[[1,-3,5],[0,-2,4],[0,1,3]],"B|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,0,2;1,1,2":[[1,-1,5],[-1,1,4],[0,-1,3]],"W|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,-1,1;1,0,2;1,1,2":[[-1,1,5],[-1,2,4],[2,-1,3]],"B|-1,-1,1;-1,0,1;-1,1,2;0,0,1;0,1,2;1,-1,1;1,0,2;1,1,2":[[2,1,5],[-2,1,4],[0,-1,3]],"W|-1,-1,1;-1,0,1;-1,1,1;0,-1,2;0,0,1;1,-1,2;1,0,2":[[-1,-2,5],[-1,2,4],[1,1,3]],"B|-1,-1,1;-1,0,1;-1,1,1;-1,2,2;0,0,1;0,1,2;1,0,2;1,1,2":[[-1,-2,5],[-2,3,4],[2,-1,3]],"B|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,-1,2;1,1,2":[[1,0,5],[-1,1,4],[0,-2,3]],"W|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,-1,2;1,0,1;1,1,2":[[2,0,5],[-2,0,4],[-1,1,3]],"B|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,-1,2;1,0,1;1,1,2;2,0,2":[[-2,0,5],[-1,1,4],[0,-2,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,0,2;1,1,2":[[1,-1,5],[1,2,4],[0,1,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-1,2;1,0,2;1,1,2":[[1,-2,5],[1,2,4],[0,-1,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-2,1;1,-1,2;1,0,2;1,1,2":[[1,2,5],[2,-1,4],[0,1,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-2,1;1,-1,2;1,0,2;1,1,2;1,2,2":[[1,3,5],[0,-1,4],[-1,-2,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-1,2;1,0,2;1,1,2;1,2,1":[[1,-2,5],[1,-3,4],[-2,0,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-2,2;1,-1,2;1,0,2;1,1,2;1,2,1":[[1,-3,5],[0,-1,4],[-2,0,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,0,2;1,1,2;1,2,2":[[1,-1,5],[1,3,4],[0,-1,3]],"W|-1,-1,1;-1,0,2;-1,1,2;-1,2,2;0,-2,1;0,0,1;1,-1,1":[[-1,3,5],[0,1,4],[0,-1,3]],"B|-1,-1,1;-1,0,2;-1,1,2;-1,2,2;-1,3,2;0,-2,1;0,0,1;1,-1,1":[[-1,4,5],[0,-1,4],[-2,0,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,0,2;1,1,2;1,2,2;1,3,1":[[1,-1,5],[1,-2,4],[0,1,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-1,2;1,0,2;1,1,2;1,2,2;1,3,1":[[1,-2,5],[0,-1,4],[1,-3,3]],"B|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,0,2;1,1,2":[[1,-3,5],[-2,0,4],[1,-1,3]],"W|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-3,1;1,0,2;1,1,2":[[2,-4,5],[-2,0,4],[1,-1,3]],"B|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-3,1;1,0,2;1,1,2;2,-4,2":[[-2,0,5],[1,-1,4],[-1,1,3]],"W|-1,-1,2;-1,0,2;0,-1,2;0,0,1;0,2,1;1,1,1;2,0,1":[[3,-1,5],[-1,3,4],[1,-1,3]],"B|-1,-1,2;-1,0,2;-1,3,2;0,-1,2;0,0,1;0,2,1;1,1,1;2,0,1":[[3,-1,5],[-1,1,4],[-1,2,3]],"B|-1,-1,1;0,0,1;0,1,2;1,0,2":[[1,1,5],[-2,-2,4],[-1,0,3]],"W|-1,0,2;0,-1,2;0,0,1;1,1,1;2,2,1":[[-1,-1,5],[3,3,4],[1,-2,3]],"B|-1,-1,2;-1,0,2;0,-1,2;0,0,1;1,1,1;2,2,1":[[3,3,5],[2,1,4],[1,2,3]],"W|-1,-1,2;-1,0,2;0,-1,2;0,0,1;1,1,1;2,2,1;3,3,1":[[4,4,5],[-1,-2,4],[-2,-1,3]],"B|-1,-1,2;-1,0,2;0,-1,2;0,0,1;1,1,1;2,2,1;3,3,1;4,4,2":[[2,1,5],[1,2,4],[3,2,3]],"W|-1,-1,2;-1,0,2;0,-1,2;0,0,1;1,1,1;1,2,1;2,2,1":[[-1,-2,5],[1,-1,4],[-2,1,3]],"B|-1,-2,2;-1,-1,2;-1,0,2;0,-1,2;0,0,1;1,1,1;1,2,1;2,2,1":[[3,3,5],[-1,1,4],[-1,-3,3]],"B|-1,0,2;0,-1,2;0,0,1;1,1,1;2,2,1;3,3,2":[[-1,-1,5],[2,1,4],[1,2,3]],"W|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,1,1;2,2,1;3,3,2":[[-2,-2,5],[1,-2,4],[-2,1,3]],"W|-1,0,2;0,-1,2;0,0,1;1,1,1;1,2,1;2,2,1;3,3,2":[[-2,1,5],[1,-2,4],[-1,-1,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-2,2;1,1,1;2,1,1;2,2,1;3,3,2":[[-1,-1,5],[2,-3,4],[-2,1,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-2,2;1,1,1;2,2,1":[[-1,-1,5],[3,3,4],[2,-3,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-2,2;1,1,1;2,2,1;3,3,1":[[2,-3,5],[-2,1,4],[-1,-1,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-2,2;1,1,1;2,-3,2;2,2,1;3,3,1":[[-1,-1,5],[4,4,4],[3,-4,3]],"W|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,0,2":[[-1,2,5],[1,1,4],[2,-1,3]],"B|-1,-1,1;-1,0,1;-1,2,2;0,0,1;0,1,2;1,0,2":[[-2,3,5],[2,-1,4],[1,1,3]],"W|-1,-1,1;0,-1,1;0,0,1;0,1,2;1,0,2;2,-1,2;3,-2,1":[[-1,2,5],[1,1,4],[-2,-2,3]],"B|-1,-1,1;-1,2,2;0,-1,1;0,0,1;0,1,2;1,0,2;2,-1,2;3,-2,1":[[-2,3,5],[1,1,4],[-2,-2,3]],"W|-1,-1,1;-1,0,1;-1,2,2;0,0,1;0,1,2;1,0,2;2,-1,1":[[-2,3,5],[1,1,4],[2,1,3]],"B|-1,-1,1;-1,2,1;0,-1,1;0,0,1;0,1,2;1,0,2;2,-1,2;3,-2,2":[[4,-3,5],[1,1,4],[-2,-2,3]],"B|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,0,2;2,-1,2":[[-1,2,5],[3,-2,4],[-1,1,3]],"W|-1,-1,1;-1,0,1;-1,2,1;0,0,1;0,1,2;1,0,2;2,-1,2":[[3,-2,5],[-1,1,4],[1,1,3]],"B|-1,-1,1;-1,0,1;-1,2,1;0,0,1;0,1,2;1,0,2;2,-1,2;3,-2,2":[[-1,1,5],[-1,-2,4],[-1,3,3]],"W|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,0,2;2,-1,2;3,-2,1":[[-1,2,5],[1,1,4],[-2,-2,3]],"B|-1,-1,1;-1,0,1;-1,2,2;0,0,1;0,1,2;1,0,2;2,-1,2;3,-2,1":[[-2,3,5],[1,1,4],[-2,-2,3]],"B|-1,0,2;0,0,1;1,-1,1;2,-2,2":[[0,-1,5],[-1,-1,4],[1,1,3]],"W|-1,0,2;0,-1,1;0,0,1;1,-1,1;2,-2,2":[[0,1,5],[-1,-1,4],[2,-1,3]],"B|-1,0,2;0,-1,1;0,0,1;0,1,2;1,-1,1;2,-2,2":[[2,-1,5],[1,0,4],[1,1,3]],"W|-1,0,2;0,-1,1;0,0,1;0,1,2;1,-1,1;2,-2,2;2,-1,1":[[-1,-1,5],[3,-1,4],[-2,-1,3]],"B|-1,-1,2;-1,0,2;0,-1,1;0,0,1;0,1,2;1,-1,1;2,-2,2;2,-1,1":[[3,-1,5],[-1,-2,4],[-1,1,3]],"W|-1,0,2;0,-1,1;0,0,1;0,1,2;1,-1,1;1,0,1;2,-2,2":[[-2,-1,5],[1,2,4],[1,-2,3]],"B|-1,0,2;0,-1,1;0,0,1;0,1,2;1,-1,1;1,0,1;1,2,2;2,-2,2":[[-2,-1,5],[2,3,4],[-1,-1,3]],"B|-1,-1,2;-1,0,2;0,-1,1;0,0,1;1,-1,1;2,-2,2":[[0,-2,5],[0,1,4],[-1,1,3]],"W|-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;1,-1,1;2,-2,2":[[0,1,5],[0,-3,4],[-1,-2,3]],"B|-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-1,1;2,-2,2":[[0,-3,5],[-1,-3,4],[2,0,3]],"W|-1,-1,2;-1,0,2;0,-1,1;0,0,1;0,1,1;1,-1,1;2,-2,2":[[0,-2,5],[0,2,4],[-1,1,3]],"B|-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,1;1,-1,1;2,-2,2":[[0,2,5],[-1,1,4],[-2,0,3]],"B|-1,0,2;0,-1,1;0,0,1;1,-1,1;2,-2,2;2,-1,2":[[0,-2,5],[0,1,4],[1,1,3]],"W|-1,0,2;0,-2,1;0,-1,1;0,0,1;1,-1,1;2,-2,2;2,-1,2":[[0,1,5],[0,-3,4],[2,0,3]],"B|-1,0,2;0,-1,2;0,0,1;0,1,1;0,2,1;1,1,1;2,1,2;2,2,2":[[0,3,5],[2,0,4],[1,0,3]],"W|-1,0,1;0,-1,2;0,0,1;1,0,1;1,1,1;1,2,2;2,2,2":[[2,0,5],[-2,0,4],[0,2,3]],"B|-1,0,1;0,-1,2;0,0,1;1,0,1;1,1,1;1,2,2;2,0,2;2,2,2":[[-2,0,5],[0,1,4],[2,1,3]],"W|-1,-1,1;-1,0,2;0,0,1;1,-1,1;2,-2,2":[[0,-1,5],[-2,-1,4],[0,1,3]],"B|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-1,1;2,-2,2":[[-2,-2,5],[1,1,4],[1,-2,3]],"W|-2,-2,1;-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-1,1;2,-2,2":[[-3,-3,5],[1,1,4],[1,-2,3]],"B|-2,-2,2;-1,-1,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,1;3,-3,2":[[-1,1,5],[-1,-2,4],[0,-2,3]],"B|-2,-1,2;-1,-1,1;-1,0,2;0,0,1;1,-1,1;2,-2,2":[[-2,-2,5],[1,1,4],[0,1,3]],"W|-2,-2,1;-2,-1,2;-1,-1,1;-1,0,2;0,0,1;1,-1,1;2,-2,2":[[-3,-3,5],[1,1,4],[-3,-2,3]],"B|-2,-2,2;-1,-1,1;0,0,1;1,-1,1;1,0,2;2,-2,1;2,-1,2;3,-3,2":[[-1,1,5],[0,1,4],[3,-2,3]],"W|-1,-1,1;0,0,1;0,1,2;1,-1,1;1,1,1;1,2,2;2,-2,2":[[2,2,5],[-2,-2,4],[-1,0,3]],"B|-1,-1,1;0,0,1;0,1,2;1,-1,1;1,1,1;1,2,2;2,-2,2;2,2,2":[[-2,-2,5],[2,-1,4],[-2,-1,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,-1,1;2,-2,2":[[1,1,5],[-2,-2,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,-1,1;1,1,1;2,-2,2":[[-2,-2,5],[2,2,4],[-2,-1,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,-1,1;1,1,1;2,-2,2;2,2,2":[[-2,-2,5],[1,2,4],[-2,-1,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-1,1;1,1,1;2,-2,1;2,2,2":[[-1,1,5],[3,-3,4],[1,-2,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,-1,1;1,1,1;2,-2,2;2,2,1":[[3,3,5],[1,2,4],[1,-2,3]],"W|-1,-1,1;0,0,1;0,1,2;1,-1,1;2,-2,2":[[1,1,5],[1,0,4],[3,-1,3]],"B|-1,-1,1;0,0,1;0,1,2;1,-1,1;1,1,2;2,-2,2":[[0,-1,5],[-1,1,4],[1,0,3]],"W|-1,-1,1;0,-1,1;0,0,1;0,1,2;1,-1,1;1,1,2;2,-2,2":[[2,-1,5],[-2,-1,4],[-1,1,3]],"B|-1,-1,1;0,-1,1;0,0,1;0,1,2;1,-1,1;1,1,2;2,-2,2;2,-1,2":[[-2,-1,5],[1,0,4],[0,-2,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,0,1;1,-1,1;1,1,1;2,2,2":[[-2,-2,5],[0,-1,4],[1,0,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;-1,1,2;0,0,1;1,-1,1;1,1,1;2,2,2":[[0,-1,5],[1,0,4],[1,-2,3]],"B|-1,-1,1;0,0,1;0,1,2;1,-1,1;2,-2,2;3,-1,2":[[1,1,5],[-2,-2,4],[0,-1,3]],"W|-1,-1,1;-1,0,2;0,0,1;1,-3,2;1,-1,1;1,1,1;2,-2,2":[[-2,-2,5],[2,2,4],[0,-4,3]],"B|-1,-1,1;0,0,1;0,1,2;1,-1,1;1,1,1;2,-2,2;2,2,2;3,-1,2":[[-2,-2,5],[1,0,4],[0,-1,3]],"W|-1,0,2;0,0,1;1,-1,1;1,1,1;1,3,2;2,-2,1;2,2,2":[[-1,1,5],[3,-3,4],[0,4,3]],"B|-1,-1,2;-1,0,2;0,0,1;1,-3,2;1,-1,1;1,1,1;2,-2,2;2,2,1":[[3,3,5],[1,0,4],[1,2,3]],"W|-1,0,1;0,-1,2;0,0,1":[[1,0,5],[-1,-1,4],[-2,0,3],[-1,1,2]],"B|-1,0,1;0,-1,2;0,0,1;1,0,2":[[-1,-2,5],[-1,1,4],[2,1,3]],"W|-1,-2,1;-1,0,1;0,-1,2;0,0,1;1,0,2":[[-1,-1,5],[1,1,4],[-1,1,3]],"B|-1,-2,1;-1,-1,2;-1,0,1;0,-1,2;0,0,1;1,0,2":[[-2,-1,5],[1,-1,4],[-2,0,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-2,1;1,-1,2;1,0,1;2,-1,1":[[0,1,5],[-1,-1,4],[3,0,3]],"B|-1,0,2;0,-1,1;0,0,1;0,1,2;1,-2,1;1,-1,2;1,0,2;2,-1,1":[[3,0,5],[0,-3,4],[0,-2,3]],"W|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-2,1;1,-1,2;1,0,1":[[2,-1,5],[-2,1,4],[0,1,3]],"B|-1,-1,1;-1,0,2;0,-1,2;0,0,1;1,-2,1;1,-1,2;1,0,1;2,-1,2":[[-2,-2,5],[1,1,4],[3,-1,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,0,1;1,2,1":[[1,1,5],[1,-1,4],[-1,-2,3]],"W|-1,-1,1;-1,0,1;-1,2,1;0,0,1;0,1,2;1,-1,2;1,0,2":[[-1,1,5],[1,1,4],[1,-2,3]],"B|-1,-1,1;-1,0,1;-1,1,2;-1,2,1;0,0,1;0,1,2;1,-1,2;1,0,2":[[1,1,5],[-2,0,4],[-2,2,3]],"B|-1,-1,2;-1,0,1;-1,2,1;0,0,1;0,1,2;1,0,2":[[-1,1,5],[-2,1,4],[-2,2,3]],"W|-1,-1,2;-1,0,1;-1,1,1;-1,2,1;0,0,1;0,1,2;1,0,2":[[-1,4,5],[-1,3,4],[1,-1,3]],"B|-1,-1,2;-1,0,1;-1,1,1;-1,2,1;-1,4,2;0,0,1;0,1,2;1,0,2":[[-2,2,5],[1,-1,4],[-2,0,3]],"W|-1,-1,2;0,-1,1;0,0,1;0,1,2;1,-2,1;1,0,2;2,-1,1":[[-1,0,5],[1,1,4],[-1,1,3]],"B|-1,-1,2;-1,0,2;0,-1,1;0,0,1;0,1,2;1,-2,1;1,0,2;2,-1,1":[[3,0,5],[0,-3,4],[0,-2,3]],"W|-1,-2,1;0,-1,2;0,0,1;0,1,1;1,0,2":[[1,-1,5],[1,-2,4],[2,1,3]],"B|-1,-1,2;-1,0,2;0,-1,2;0,0,1;0,1,1;1,-2,1":[[1,-1,5],[1,0,4],[-1,1,3]],"W|-1,-1,2;-1,0,2;0,-1,2;0,0,1;0,1,1;1,-2,1;1,-1,1":[[-1,1,5],[2,-2,4],[1,0,3]],"B|-1,-1,2;-1,0,1;0,-1,2;0,0,1;1,-1,2;1,0,2;1,1,1;2,1,1":[[2,-1,5],[-2,-1,4],[0,1,3]],"W|-1,-1,2;-1,0,2;0,-1,2;0,0,1;0,1,1;1,-2,1;1,0,1":[[-1,-2,5],[-1,2,4],[-1,1,3]],"B|-1,-2,1;-1,0,1;0,-1,2;0,0,1;0,1,1;1,-2,2;1,-1,2;1,0,2":[[1,1,5],[1,-3,4],[-1,-1,3]],"B|-1,-2,1;0,-1,2;0,0,1;0,1,1;1,-2,2;1,0,2":[[-1,1,5],[-1,0,4],[1,1,3]],"W|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,0,2;2,-1,1;2,1,2":[[-1,-2,5],[3,2,4],[1,1,3]],"B|-1,-2,2;-1,-1,1;-1,0,1;0,0,1;0,1,2;1,0,2;2,-1,1;2,1,2":[[0,-1,5],[1,1,4],[-2,-2,3]],"W|-1,-2,1;-1,0,1;0,-1,2;0,0,1;0,1,1;1,-2,2;1,0,2":[[1,-1,5],[1,-3,4],[1,1,3]],"B|-1,-2,1;0,-1,2;0,0,1;0,1,1;1,0,2;2,1,2":[[3,2,5],[-1,-1,4],[1,-1,3]],"W|-1,-2,1;0,-1,2;0,0,1;0,1,1;1,0,2;2,1,2;3,2,1":[[1,-1,5],[1,2,4],[1,-2,3]],"B|-1,-2,1;0,-1,2;0,0,1;0,1,1;1,-1,2;1,0,2;2,1,2;3,2,1":[[-1,-1,5],[-1,0,4],[1,1,3]],"W|-1,-2,1;-1,-1,1;0,-1,2;0,0,1;0,1,1;1,0,2;2,1,2":[[3,2,5],[-1,0,4],[-1,-3,3]],"B|-1,-2,1;-1,-1,1;0,-1,2;0,0,1;0,1,1;1,0,2;2,1,2;3,2,2":[[4,3,5],[-1,0,4],[-2,-2,3]],"B|-1,-1,2;-1,0,1;0,-1,2;0,0,1":[[-2,0,5],[1,0,4],[-2,-1,3]],"W|-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1":[[0,1,5],[0,-3,4],[-1,-2,3]],"B|-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,2":[[0,-3,5],[-1,-2,4],[-1,1,3]],"W|-1,-1,2;-1,0,2;0,-3,1;0,-2,1;0,-1,1;0,0,1;0,1,2":[[0,-4,5],[-1,-2,4],[-1,1,3]],"B|-1,-1,2;-1,0,2;0,-4,2;0,-3,1;0,-2,1;0,-1,1;0,0,1;0,1,2":[[-1,-2,5],[1,2,4],[-2,-1,3]],"W|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,2":[[1,2,5],[-2,-1,4],[0,-3,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,2,2":[[0,-3,5],[-2,-1,4],[2,3,3]],"B|-1,-1,2;-1,0,2;0,-3,2;0,-2,1;0,-1,1;0,0,1":[[0,1,5],[-1,1,4],[-1,-2,3]],"W|-1,-1,2;-1,0,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,1":[[0,2,5],[-1,-2,4],[-1,1,3]],"B|-1,-1,2;-1,0,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,1;0,2,2":[[-1,1,5],[-1,-2,4],[-1,2,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,0,1;0,1,1;0,2,1;0,3,2":[[0,-1,5],[0,-2,4],[1,1,3]],"B|-1,-1,1;-1,0,2;-1,1,2;0,-1,2;0,0,1;0,1,1;0,2,1;0,3,2":[[1,1,5],[-2,-2,4],[1,-2,3]],"B|-1,-2,2;-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1":[[0,-3,5],[0,1,4],[-1,-3,3]],"W|-1,-2,2;-1,-1,2;-1,0,2;0,-3,1;0,-2,1;0,-1,1;0,0,1":[[-1,-3,5],[-1,1,4],[-1,-4,3]],"B|-1,-3,2;-1,-2,2;-1,-1,2;-1,0,2;0,-3,1;0,-2,1;0,-1,1;0,0,1":[[0,-4,5],[0,1,4],[-1,-4,3]],"W|-1,-2,2;-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,1":[[-1,1,5],[-1,-3,4],[-1,2,3]],"B|-1,-1,2;-1,0,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,-1,2;2,0,1":[[3,0,5],[-2,0,4],[3,-1,3]],"W|-1,-1,2;-1,0,1;0,-1,2;0,0,1;1,0,1":[[-2,0,5],[2,0,4],[1,-1,3]],"B|-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,1":[[0,2,5],[-1,1,4],[-2,0,3]],"W|-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,1;0,2,1":[[0,3,5],[-1,1,4],[-1,-2,3]],"B|-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,1;0,2,1;0,3,2":[[-1,1,5],[1,-3,4],[-2,0,3]],"W|-1,-1,1;-1,0,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,0,2":[[3,1,5],[0,-2,4],[-2,0,3]],"B|-1,-1,1;-1,0,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,0,2;3,1,2":[[-2,0,5],[0,-2,4],[4,2,3]],"B|-1,-1,2;-1,0,1;0,-1,2;0,0,1;1,0,1;2,0,2":[[-2,0,5],[-2,-1,4],[1,-1,3]],"W|-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,1;0,2,2":[[0,-3,5],[-1,1,4],[-1,-2,3]],"W|-1,-2,1;-1,-1,2;-1,0,2;0,-1,1;0,0,1;0,1,1;0,2,2":[[0,-2,5],[0,-3,4],[1,0,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,1;0,2,2":[[1,0,5],[-2,-3,4],[1,-3,3]],"B|-1,-1,2;-1,0,1;0,-1,2;0,0,1;1,-1,2;1,0,1":[[2,0,5],[-2,0,4],[2,-1,3]],"W|-1,-1,2;-1,0,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,0,1":[[2,-1,5],[-2,-1,4],[3,-1,3]],"W|-1,-2,1;-1,-1,2;-1,0,2;0,-1,1;0,0,1":[[0,1,5],[0,-2,4],[1,0,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-1,1;0,0,1;0,1,2":[[1,0,5],[-2,-3,4],[-2,-1,3]],"W|-1,-2,1;-1,-1,2;-1,0,2;0,-1,1;0,0,1;0,1,2;1,0,1":[[-2,-3,5],[2,1,4],[-2,-1,3]],"B|-1,0,1;0,-1,1;0,0,1;0,1,2;1,-2,1;1,-1,2;1,0,2;2,-3,2":[[-2,1,5],[2,-1,4],[-1,2,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-1,2;1,0,1;2,-1,1;3,-2,1":[[0,1,5],[4,-3,4],[1,-2,3]],"B|-1,0,2;0,-1,1;0,0,1;0,1,2;1,-2,1;1,-1,2;1,0,2;2,-3,1":[[3,-4,5],[4,-5,4],[0,-2,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[-2,-3,5],[1,0,4],[-2,0,3]],"W|-2,-3,1;-1,-2,1;-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[-3,-4,5],[1,0,4],[1,-3,3]],"B|-3,-4,2;-2,-3,1;-1,-2,1;-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[1,0,5],[-2,0,4],[1,-3,3]],"W|-1,-2,1;-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,0,1":[[-2,-3,5],[2,1,4],[1,-3,3]],"B|-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-2,1;1,-1,2;1,0,2;2,-3,2":[[-2,1,5],[-1,-3,4],[2,0,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-1,1;0,0,1;1,0,2":[[0,-2,5],[0,1,4],[-2,-3,3]],"W|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;1,0,2":[[0,1,5],[0,-3,4],[-2,-2,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,0,2":[[0,-3,5],[1,-2,4],[-3,-2,3]],"W|-1,-2,1;-1,-1,2;-1,0,2;0,-1,1;0,0,1;0,1,1;1,0,2":[[0,-2,5],[0,2,4],[-1,1,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,1;1,0,2":[[0,2,5],[1,-3,4],[-2,0,3]],"B|-1,0,2;0,-2,2;0,-1,1;0,0,1":[[-1,-1,5],[1,-1,4],[-1,-2,3]],"W|-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[1,-1,5],[-2,-1,4],[-2,-2,3]],"B|-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,2":[[-2,-2,5],[1,1,4],[2,0,3]],"W|-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,-1,1;1,0,2;2,-2,1":[[3,-3,5],[-1,1,4],[1,-3,3]],"B|-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,-1,1;1,0,2;2,-2,1;3,-3,2":[[-1,1,5],[1,-3,4],[1,-2,3]],"W|-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,1,1":[[-2,-2,5],[2,2,4],[2,0,3]],"B|-1,-1,1;-1,1,2;0,0,1;0,1,1;0,2,2;1,0,2;1,1,1;2,2,2":[[-2,-2,5],[-2,0,4],[0,-1,3]],"B|-2,-1,2;-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[-2,-2,5],[1,1,4],[0,1,3]],"W|-2,-2,1;-2,-1,2;-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[-3,-3,5],[1,1,4],[-3,-2,3]],"B|-3,-3,2;-2,-2,1;-2,-1,2;-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[1,1,5],[0,1,4],[-3,-2,3]],"W|-1,-1,1;0,0,1;0,1,1;0,2,2;1,0,2;1,1,1;2,1,2":[[2,2,5],[-2,-2,4],[0,-1,3]],"B|-1,-1,1;0,0,1;0,1,1;0,2,2;1,0,2;1,1,1;2,1,2;2,2,2":[[-2,-2,5],[0,-1,4],[3,2,3]],"W|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,0,2":[[1,-1,5],[-2,-1,4],[0,1,3]],"B|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,2":[[1,1,5],[1,-2,4],[-1,0,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,0,1;0,1,1;0,2,2;1,1,1":[[-2,-2,5],[2,2,4],[-2,0,3]],"B|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,2;1,1,1;2,2,2":[[-2,-2,5],[2,0,4],[-1,-3,3]],"W|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-2,1;1,-1,2;1,0,2":[[-1,-3,5],[2,0,4],[-1,0,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-3,2;1,-1,1":[[2,-4,5],[-2,0,4],[1,0,3]],"B|-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,1;2,-1,2":[[-1,1,5],[2,-2,4],[0,1,3]],"W|-1,-1,1;-1,0,2;0,0,1;0,1,1;0,2,2;1,1,1;2,1,2":[[2,2,5],[-2,-2,4],[1,2,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,1;0,2,2;1,1,1;2,1,2;2,2,2":[[-2,-2,5],[1,0,4],[1,2,3]],"W|-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,1;2,-2,1;2,-1,2":[[-1,1,5],[3,-3,4],[-1,-1,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,1;0,2,2;1,1,1;2,1,2;2,2,1":[[3,3,5],[-1,1,4],[1,-1,3]],"B|-1,-1,1;0,-2,2;0,-1,1;0,0,1;0,1,2;1,0,2":[[1,1,5],[-2,-2,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;0,-1,2;0,0,1;0,1,1;0,2,2;1,1,1":[[-2,-2,5],[2,2,4],[-2,1,3]],"B|-1,-1,1;0,-2,2;0,-1,1;0,0,1;0,1,2;1,0,2;1,1,1;2,2,2":[[-2,-2,5],[-2,-1,4],[2,-1,3]],"W|-1,0,2;0,-1,2;0,0,1;0,1,1;0,2,2;1,1,1;2,2,1":[[-1,-1,5],[3,3,4],[-2,1,3]],"B|-1,-1,2;-1,0,2;0,-1,2;0,0,1;0,1,1;0,2,2;1,1,1;2,2,1":[[3,3,5],[3,1,4],[1,-1,3]],"W|-1,-2,1;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[1,0,5],[0,1,4],[-1,-1,3]],"B|-1,-2,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,0,2":[[1,-1,5],[-1,-1,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-2,1;1,0,2":[[-2,-1,5],[1,-1,4],[0,1,3]],"B|-1,-2,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,1;1,0,2;2,-1,2":[[-1,1,5],[2,-2,4],[0,1,3]],"W|-1,-2,1;-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,0,2":[[-2,-1,5],[1,-1,4],[0,1,3]],"B|-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-2,1;1,-1,1;1,0,2;2,-1,2":[[-1,1,5],[2,-2,4],[0,1,3]],"B|-1,-2,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,2":[[1,0,5],[-2,-3,4],[-2,-1,3]],"W|-1,-2,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,2;1,0,1":[[-2,-3,5],[2,1,4],[-2,-1,3]],"B|-1,0,1;0,-1,2;0,0,1;0,1,1;0,2,2;1,0,2;1,2,1;2,3,2":[[-2,-1,5],[2,1,4],[-1,-2,3]],"W|-1,0,2;0,-1,2;0,0,1;1,0,1;2,-1,1;2,0,2;3,-2,1":[[0,1,5],[4,-3,4],[1,-2,3]],"B|-1,0,2;0,-1,2;0,0,1;0,1,1;0,2,2;1,0,2;1,2,1;2,3,1":[[3,4,5],[4,5,4],[1,-2,3]],"B|-1,-1,2;-1,0,1;0,0,1;0,1,2":[[-2,0,5],[1,0,4],[-1,1,3]],"W|-1,-1,2;0,-2,1;0,-1,1;0,0,1;1,0,2":[[0,1,5],[0,-3,4],[1,-1,3]],"B|-1,-1,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,0,2":[[0,-3,5],[2,-1,4],[-1,2,3]],"W|-1,-1,2;0,-3,1;0,-2,1;0,-1,1;0,0,1;0,1,2;1,0,2":[[0,-4,5],[2,-1,4],[-1,2,3]],"B|-1,-1,2;0,-4,2;0,-3,1;0,-2,1;0,-1,1;0,0,1;0,1,2;1,0,2":[[2,-1,5],[-1,2,4],[-1,-3,3]],"W|-1,-1,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,0,2;2,-1,1":[[0,-3,5],[1,-1,4],[-1,0,3]],"B|-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,0,2;2,-1,1":[[1,-1,5],[2,-2,4],[2,0,3]],"B|-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;1,0,2":[[0,1,5],[1,-2,4],[1,-1,3]],"W|-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,1;1,0,2":[[0,2,5],[-1,-2,4],[1,-2,3]],"B|-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,1;0,2,2;1,0,2":[[1,-2,5],[-1,1,4],[-1,0,3]],"W|-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;1,-2,1;1,0,2":[[0,1,5],[-1,-2,4],[-1,0,3]],"B|-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-2,1;1,0,2":[[-1,-2,5],[-1,0,4],[2,-3,3]],"B|-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;1,-1,2":[[0,1,5],[0,-3,4],[-1,-2,3]],"W|-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,1;1,-1,2":[[0,-3,5],[0,2,4],[-1,-2,3]],"B|-1,-1,2;-1,0,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,1;1,-1,2":[[0,2,5],[-1,-2,4],[-1,1,3]],"W|-1,-1,2;-1,0,2;0,-3,1;0,-2,1;0,-1,1;0,0,1;1,-1,2":[[0,1,5],[0,-4,4],[-1,-2,3]],"B|-1,-1,2;-1,0,2;0,-3,1;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-1,2":[[0,-4,5],[-1,-2,4],[-1,1,3]],"W|-1,-1,2;-1,0,1;0,0,1;0,1,2;1,0,1":[[-2,0,5],[2,0,4],[0,-1,3]],"B|-1,-1,2;0,-2,2;0,-1,1;0,0,1;0,1,1;1,0,2":[[0,2,5],[-2,0,4],[1,-3,3]],"W|-1,-1,2;0,-2,2;0,-1,1;0,0,1;0,1,1;0,2,1;1,0,2":[[0,3,5],[1,-3,4],[-2,0,3]],"B|-1,-1,2;0,-2,2;0,-1,1;0,0,1;0,1,1;0,2,1;0,3,2;1,0,2":[[-2,0,5],[1,-3,4],[1,2,3]],"W|-1,0,1;0,-1,2;0,0,1;0,2,1;1,0,1;1,1,2;2,0,2":[[-2,0,5],[0,1,4],[1,-1,3]],"B|-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,1;0,2,2;1,-1,2;2,0,1":[[1,0,5],[2,1,4],[2,-1,3]],"B|-1,-1,2;-1,0,1;0,0,1;0,1,2;1,0,1;2,0,2":[[-2,0,5],[1,-1,4],[0,-1,3]],"W|-1,-1,2;0,-2,1;0,-1,1;0,0,1;0,1,1;0,2,2;1,0,2":[[0,-3,5],[1,1,4],[-1,1,3]],"W|-1,-1,1;-1,1,2;0,-2,2;0,-1,1;0,0,1;0,1,1;1,0,2":[[0,2,5],[1,-1,4],[1,1,3]],"B|-1,-1,1;-1,1,2;0,-2,2;0,-1,1;0,0,1;0,1,1;0,2,2;1,0,2":[[1,1,5],[1,-1,4],[-2,-2,3]],"B|-1,-1,2;-1,0,1;0,-1,2;0,0,1;0,1,2;1,0,1":[[-2,0,5],[2,0,4],[1,-1,3]],"W|-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,1;1,0,2":[[0,2,5],[0,-3,4],[-1,1,3]],"B|-1,-1,2;-1,0,2;0,-2,1;0,-1,1;0,0,1;0,1,1;0,2,2;1,0,2":[[0,-3,5],[-1,1,4],[-1,-2,3]],"W|-1,-1,2;-1,0,1;0,-1,2;0,0,1;0,1,2;1,0,1;2,0,1":[[-2,0,5],[3,0,4],[1,-1,3]],"B|-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,1;0,2,1;1,0,2":[[0,3,5],[-1,1,4],[-1,-2,3]],"W|-1,-1,1;-1,0,1;-1,1,2;0,-1,2;0,0,1":[[1,0,5],[-2,0,4],[1,1,3]],"B|-1,-1,1;-1,0,1;-1,1,2;0,-1,2;0,0,1;1,0,2":[[1,1,5],[-2,-2,4],[-1,-2,3]],"W|-1,-1,1;-1,0,1;-1,1,2;0,-1,2;0,0,1;1,0,2;1,1,1":[[-2,-2,5],[2,2,4],[-1,-2,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,-1,2;1,0,1;1,1,1;2,2,2":[[-2,-2,5],[1,2,4],[-2,-1,3]],"W|-1,-1,2;0,-1,1;0,0,1;0,1,2;1,-1,1;1,0,2;2,-2,1":[[-1,1,5],[3,-3,4],[2,-1,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,1,2;1,-1,2;1,0,1;1,1,1;2,2,1":[[3,3,5],[4,4,4],[-2,-1,3]],"B|-1,-1,2;0,0,1":[[-1,1,5],[1,-1,4],[-2,0,3],[0,-2,2],[-1,0,1]],"W|-1,-1,1;-1,1,2;0,0,1":[[1,1,5],[-2,0,4],[0,2,3],[-2,-2,2]],"B|-1,-1,1;-1,1,2;0,0,1;1,1,2":[[-1,0,5],[1,0,4],[-2,1,3]],"W|-1,-1,1;-1,0,1;-1,1,2;0,0,1;1,1,2":[[0,1,5],[-2,0,4],[1,0,3]],"B|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,1,2":[[1,0,5],[-1,-2,4],[-1,0,3]],"W|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,1;1,1,2":[[2,0,5],[2,1,4],[-1,0,3]],"B|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,1;1,1,2;2,0,2":[[-1,-3,5],[3,1,4],[-1,-2,3]],"W|-1,-1,2;-1,1,2;0,-2,2;0,-1,1;0,0,1;1,-2,1;1,-1,1":[[-1,0,5],[1,-3,4],[1,0,3]],"B|-1,-1,2;-1,0,2;-1,1,2;0,-2,2;0,-1,1;0,0,1;1,-2,1;1,-1,1":[[-1,-2,5],[-1,2,4],[1,-3,3]],"B|-1,-1,1;-1,0,1;-1,1,2;0,0,1;1,0,2;1,1,2":[[0,1,5],[0,-1,4],[-2,-1,3]],"W|-1,-1,1;-1,0,1;-1,1,2;0,0,1;0,1,1;1,0,2;1,1,2":[[1,2,5],[0,2,4],[-2,-1,3]],"B|-1,-1,1;-1,0,1;-1,1,2;0,0,1;0,1,1;1,0,2;1,1,2;1,2,2":[[1,3,5],[1,-1,4],[0,-1,3]],"W|-1,-1,1;-1,0,1;-1,1,2;0,-1,1;0,0,1;1,0,2;1,1,2":[[1,-2,5],[1,2,4],[0,1,3]],"B|-1,-1,1;-1,0,1;-1,1,2;0,-1,1;0,0,1;1,-2,2;1,0,2;1,1,2":[[1,-1,5],[0,1,4],[0,-2,3]],"W|-1,-1,1;-1,1,2;0,0,1;1,0,1;1,1,2":[[0,1,5],[2,0,4],[-2,0,3]],"B|-1,-1,1;-1,1,2;0,0,1;0,1,2;1,0,1;1,1,2":[[2,1,5],[-2,1,4],[-1,0,3]],"W|-1,-1,1;-1,1,2;0,0,1;0,1,2;1,0,1;1,1,2;2,1,1":[[-2,1,5],[-3,1,4],[0,-1,3]],"B|-1,-1,1;0,0,1;0,1,1;1,-2,2;1,-1,2;1,0,2;1,1,2;1,2,1":[[1,-3,5],[0,2,4],[0,-1,3]],"W|-1,-1,1;0,0,1;0,1,1;1,-2,1;1,-1,2;1,0,2;1,1,2":[[1,2,5],[0,2,4],[0,-1,3]],"B|-1,-1,1;0,0,1;0,1,1;1,-2,1;1,-1,2;1,0,2;1,1,2;1,2,2":[[1,3,5],[0,-1,4],[0,2,3]],"B|-1,-1,1;-1,1,2;0,0,1;1,0,1;1,1,2;2,0,2":[[0,-1,5],[3,-1,4],[0,2,3]],"W|-1,-1,1;-1,0,1;0,0,1;0,1,1;0,2,2;1,-1,2;1,1,2":[[2,0,5],[-1,3,4],[1,2,3]],"B|-1,-1,1;-1,0,1;0,0,1;0,1,1;0,2,2;1,-1,2;1,1,2;2,0,2":[[3,-1,5],[-1,3,4],[1,2,3]],"W|-1,-1,1;-1,1,2;0,0,1;1,0,1;1,1,2;2,0,2;3,-1,1":[[0,1,5],[0,2,4],[-2,0,3]],"B|-1,-1,1;-1,1,2;0,0,1;0,1,2;1,0,1;1,1,2;2,0,2;3,-1,1":[[2,1,5],[-2,1,4],[0,-1,3]],"B|-1,-1,1;0,-2,2;0,0,1;0,1,1;1,-1,2;1,1,2":[[0,2,5],[-1,0,4],[-1,-3,3]],"W|-1,-1,1;0,-2,2;0,0,1;0,1,1;0,2,1;1,-1,2;1,1,2":[[0,3,5],[1,0,4],[-1,-3,3]],"B|-1,-1,1;0,-2,2;0,0,1;0,1,1;0,2,1;0,3,2;1,-1,2;1,1,2":[[-1,0,5],[1,2,4],[-1,2,3]],"W|-1,-1,1;-1,0,1;0,-2,2;0,0,1;0,1,1;1,-1,2;1,1,2":[[-1,-3,5],[1,2,4],[1,-2,3]],"B|-1,-1,2;-1,0,1;0,0,1;0,1,1;1,-1,2;1,1,1;2,0,2;3,1,2":[[0,-2,5],[4,2,4],[0,-1,3]],"W|-1,-1,1;0,0,1;1,-2,1;1,-1,2;1,1,2":[[2,0,5],[0,1,4],[1,0,3]],"B|-1,-1,1;0,0,1;1,-2,1;1,-1,2;1,1,2;2,0,2":[[0,-2,5],[-1,0,4],[3,-1,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-2,1;1,-1,2;1,1,2;2,0,2":[[3,-1,5],[0,2,4],[1,0,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-2,1;1,-1,2;1,1,2;2,0,2;3,-1,2":[[4,-2,5],[0,2,4],[-1,-2,3]],"W|-1,-1,1;-1,0,1;0,0,1;1,-2,1;1,-1,2;1,1,2;2,0,2":[[3,-1,5],[3,1,4],[0,2,3]],"B|-1,-1,1;-1,0,1;0,0,1;1,-2,1;1,-1,2;1,1,2;2,0,2;3,-1,2":[[4,-2,5],[0,2,4],[-2,0,3]],"B|-1,-1,1;0,0,1;0,1,2;1,-2,1;1,-1,2;1,1,2":[[-1,0,5],[-2,0,4],[0,-2,3]],"W|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,-2,1;1,-1,2;1,1,2":[[1,0,5],[-1,1,4],[2,1,3]],"B|-1,-1,1;-1,0,1;0,0,1;0,1,2;1,-2,1;1,-1,2;1,0,2;1,1,2":[[0,-1,5],[-2,1,4],[2,-3,3]],"W|-1,-1,2;-1,0,2;0,0,1;0,2,1;1,-1,2;1,1,1;2,-1,1":[[-1,1,5],[-1,-2,4],[2,0,3]],"B|-1,-1,2;-1,0,2;-1,1,2;0,-2,1;0,0,1;1,-1,1;1,1,2;2,1,1":[[-1,-2,5],[-1,2,4],[2,0,3]],"B|-1,-1,1;0,0,1;1,-2,1;1,-1,2;1,0,2;1,1,2":[[1,2,5],[0,-2,4],[0,-1,3]],"W|-1,-1,1;0,0,1;1,-2,1;1,-1,2;1,0,2;1,1,2;1,2,1":[[2,0,5],[2,-1,4],[0,1,3]],"B|-1,-1,1;0,0,1;1,-2,1;1,-1,2;1,0,2;1,1,2;1,2,1;2,0,2":[[0,-2,5],[0,2,4],[0,1,3]],"B|-1,-1,1;0,-2,2;0,0,1;1,-1,2":[[-2,-2,5],[1,1,4],[2,0,3]],"W|-1,-1,2;0,-2,2;0,0,1;1,-1,1;2,-2,1":[[3,-3,5],[-1,1,4],[1,-3,3]],"B|-1,-1,2;0,-2,2;0,0,1;1,-1,1;2,-2,1;3,-3,2":[[-1,1,5],[1,-3,4],[-2,0,3]],"W|-1,-1,1;-1,1,2;0,0,1;0,2,2;1,1,1;2,2,1;3,3,2":[[-2,-2,5],[1,3,4],[-2,0,3]],"B|-2,-2,2;-1,-1,1;-1,1,2;0,0,1;0,2,2;1,1,1;2,2,1;3,3,2":[[-2,0,5],[1,3,4],[2,1,3]],"W|-1,-1,2;0,-2,2;0,0,1;1,-3,1;1,-1,1;2,-2,1;3,-3,2":[[-1,1,5],[0,-4,4],[3,-1,3]],"B|-1,-1,2;-1,1,2;0,-2,2;0,0,1;1,-3,1;1,-1,1;2,-2,1;3,-3,2":[[0,-4,5],[3,-1,4],[1,-2,3]],"B|-1,-1,2;-1,1,2;0,-2,2;0,0,1;1,-1,1;2,-2,1":[[3,-3,5],[1,-3,4],[0,1,3]],"W|-1,-1,2;-1,1,2;0,-2,2;0,0,1;1,-1,1;2,-2,1;3,-3,1":[[4,-4,5],[-2,0,4],[1,-3,3]],"B|-1,-1,2;-1,1,2;0,-2,2;0,0,1;1,-1,1;2,-2,1;3,-3,1;4,-4,2":[[1,-3,5],[0,1,4],[2,-1,3]],"W|-1,-1,2;-1,1,2;0,-2,2;0,0,1;1,-3,1;1,-1,1;2,-2,1":[[-1,0,5],[-1,-2,4],[-1,2,3]],"B|-1,-1,2;-1,0,2;-1,1,2;0,-2,2;0,0,1;1,-3,1;1,-1,1;2,-2,1":[[3,-3,5],[-1,-2,4],[-1,2,3]],"B|-1,-1,2;0,-2,2;0,0,1;1,-3,2;1,-1,1;2,-2,1":[[3,-3,5],[-1,1,4],[2,-4,3]],"W|-1,-1,2;0,-2,2;0,0,1;1,-3,2;1,-1,1;2,-2,1;3,-3,1":[[2,-4,5],[-2,0,4],[4,-4,3]],"B|-1,-1,2;0,-2,2;0,0,1;1,-3,2;1,-1,1;2,-4,2;2,-2,1;3,-3,1":[[4,-4,5],[-1,1,4],[3,-5,3]],"W|-1,-1,1;-1,1,2;0,0,1;0,2,2;1,1,1;1,3,2;2,2,1":[[-2,0,5],[2,4,4],[3,3,3]],"B|-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,1;2,0,2;2,2,1;3,1,2":[[3,3,5],[-2,-2,4],[4,2,3]],"W|-1,-1,1;-1,1,2;0,0,1;0,2,2;1,1,1":[[2,2,5],[-2,-2,4],[-2,0,3]],"B|-1,-1,1;-1,1,2;0,0,1;0,2,2;1,1,1;2,2,2":[[-2,-2,5],[-2,0,4],[0,-1,3]],"W|-2,-2,1;-1,-1,1;-1,1,2;0,0,1;0,2,2;1,1,1;2,2,2":[[-3,-3,5],[1,3,4],[-2,0,3]],"B|-2,-2,2;-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,1;2,2,1;3,3,2":[[2,0,5],[0,1,4],[2,1,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-1,2;1,1,1;2,0,2;2,2,2":[[2,1,5],[2,-1,4],[2,3,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-1,2;1,1,1;2,0,2;2,1,2;2,2,2":[[-2,-2,5],[2,-1,4],[2,3,3]],"B|-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,1;2,2,2":[[-2,-2,5],[2,0,4],[-1,-3,3]],"W|-2,-2,1;-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,1;2,2,2":[[-3,-3,5],[-1,-3,4],[2,0,3]],"W|-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,1;2,0,1;2,2,2":[[-2,-2,5],[3,-1,4],[0,2,3]],"B|-2,-2,2;-1,-1,1;0,-2,1;0,0,1;1,-1,2;1,1,1;2,0,2;2,2,2":[[1,-3,5],[-2,0,4],[0,-1,3]],"B|-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,1;2,0,2":[[-2,-2,5],[2,2,4],[-1,-3,3]],"W|-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,1;2,0,2;2,2,1":[[3,1,5],[-1,-3,4],[3,3,3]],"W|-1,-1,1;0,-2,2;0,0,1;1,-1,2;2,0,1":[[-2,-2,5],[1,1,4],[1,-2,3]],"B|-2,-2,2;-1,-1,1;0,-2,2;0,0,1;1,-1,2;2,0,1":[[1,0,5],[-1,0,4],[-1,-2,3]],"W|-2,-2,2;-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,0,1;2,0,1":[[-1,0,5],[3,0,4],[-1,-2,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;0,-2,2;0,0,1;1,-1,2;1,0,1;2,0,1":[[3,0,5],[-1,-2,4],[2,-1,3]],"W|-2,-2,2;-1,-1,1;-1,0,1;0,-2,2;0,0,1;1,-1,2;2,0,1":[[1,0,5],[-1,-2,4],[-2,0,3]],"B|-2,-2,2;-1,-1,1;-1,0,1;0,-2,2;0,0,1;1,-1,2;1,0,2;2,0,1":[[-1,-2,5],[1,-2,4],[0,-1,3]],"B|-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,2;2,0,1":[[1,0,5],[0,1,4],[1,2,3]],"W|-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,0,1;1,1,2;2,0,1":[[-1,0,5],[3,0,4],[2,-1,3]],"B|-1,-1,1;-1,0,2;0,-2,2;0,0,1;1,-1,2;1,0,1;1,1,2;2,0,1":[[3,0,5],[-2,-2,4],[0,1,3]],"W|-1,-1,1;0,-2,2;0,0,1;0,1,1;1,-1,2;1,1,2;2,0,1":[[1,0,5],[2,-1,4],[3,0,3]],"B|-1,-1,1;0,-2,2;0,0,1;0,1,1;1,-1,2;1,0,2;1,1,2;2,0,1":[[1,-2,5],[1,2,4],[0,2,3]],"B|-1,-1,1;0,-2,2;0,0,1;1,-2,2;1,-1,2;2,0,1":[[1,0,5],[-1,-2,4],[-2,-2,3]],"W|-1,-1,1;0,-2,2;0,0,1;1,-2,2;1,-1,2;1,0,1;2,0,1":[[-1,0,5],[3,0,4],[-1,-2,3]],"B|-1,-1,1;-1,0,2;0,-2,2;0,0,1;1,-2,2;1,-1,2;1,0,1;2,0,1":[[3,0,5],[-2,-2,4],[0,-1,3]],"W|-1,-2,1;-1,-1,1;0,-2,2;0,0,1;1,-2,2;1,-1,2;2,0,1":[[2,-1,5],[0,-3,4],[1,1,3]],"B|-1,-2,1;-1,-1,1;0,-2,2;0,0,1;1,-2,2;1,-1,2;2,-1,2;2,0,1":[[-1,0,5],[1,1,4],[-2,-2,3]],"B|-1,-1,1;-1,1,2;0,0,1;0,2,2":[[1,1,5],[-2,-2,4],[-2,0,3]],"W|-2,-2,1;-1,-1,1;-1,1,2;0,0,1;0,2,2":[[1,1,5],[-3,-3,4],[-2,0,3]],"B|-1,-1,2;0,-2,2;0,0,1;1,-1,2;1,1,1;2,2,1":[[3,3,5],[2,0,4],[-2,0,3]],"W|-1,-1,2;0,-2,2;0,0,1;1,-1,2;1,1,1;2,2,1;3,3,1":[[4,4,5],[2,0,4],[1,-3,3]],"B|-1,-1,2;0,-2,2;0,0,1;1,-1,2;1,1,1;2,2,1;3,3,1;4,4,2":[[2,0,5],[-2,0,4],[2,1,3]],"W|-1,-1,2;0,-2,2;0,0,1;1,-1,2;1,1,1;2,0,1;2,2,1":[[1,-3,5],[-2,0,4],[2,-1,3]],"B|-1,-1,2;0,-2,2;0,0,1;1,-3,2;1,-1,2;1,1,1;2,0,1;2,2,1":[[3,3,5],[2,-4,4],[-2,0,3]],"B|-2,0,2;-1,-1,2;0,0,1;1,-1,1;2,-2,1;3,-3,2":[[-1,1,5],[0,-2,4],[2,-1,3]],"W|-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,1;2,2,1;3,3,2":[[-2,-2,5],[2,0,4],[-1,-3,3]],"W|-2,0,2;-1,-1,2;0,-2,1;0,0,1;1,-1,1;2,-2,1;3,-3,2":[[-1,1,5],[1,-2,4],[-1,-3,3]],"B|-1,-1,2;0,-2,2;0,0,1;1,-1,2;1,1,1;2,0,1;2,2,1;3,3,2":[[3,-1,5],[0,2,4],[1,0,3]],"B|-2,-2,1;-1,-1,1;0,-2,2;0,0,1;1,-1,2;2,0,2":[[1,1,5],[-3,-3,4],[-1,-3,3]],"W|-2,0,2;-1,-1,2;0,-2,2;0,0,1;1,-1,1;2,-2,1;3,-3,1":[[1,-3,5],[-3,1,4],[2,-4,3]],"B|-2,0,2;-1,-1,2;0,-2,2;0,0,1;1,-3,2;1,-1,1;2,-2,1;3,-3,1":[[-1,1,5],[4,-4,4],[2,-4,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-1,2;2,0,2":[[1,1,5],[1,-3,4],[1,-2,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-1,2;1,1,2;2,0,2":[[1,-3,5],[-2,0,4],[0,-1,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-3,1;1,-1,2;1,1,2;2,0,2":[[2,-4,5],[-2,0,4],[3,-1,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-3,1;1,-1,2;1,1,2;2,-4,2;2,0,2":[[-2,0,5],[0,-1,4],[0,-3,3]],"W|-1,-1,2;0,-2,2;0,0,1;0,2,1;1,-1,2;1,1,1;2,0,1":[[3,-1,5],[-1,3,4],[1,-3,3]],"B|-1,-1,2;0,-2,2;0,0,1;0,2,1;1,-1,2;1,1,1;2,0,1;3,-1,2":[[-1,3,5],[0,1,4],[1,0,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-3,2;1,-1,2;2,0,2":[[1,1,5],[-2,-2,4],[0,-1,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-3,2;1,-1,2;1,1,1;2,0,2":[[-2,-2,5],[2,2,4],[1,-2,3]],"B|-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,1;2,0,1;2,2,2;3,-1,2":[[-2,-2,5],[1,0,4],[-1,0,3]],"W|-2,-2,1;-1,-1,1;0,-2,1;0,0,1;1,-3,2;1,-1,2;2,0,2":[[1,1,5],[-3,-3,4],[1,-2,3]],"B|-1,-1,2;0,-2,2;0,0,1;1,-1,2;1,1,1;2,0,1;2,2,1;3,-1,2":[[3,3,5],[1,0,4],[2,-1,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-2,2;1,-1,2;2,0,2":[[1,-3,5],[1,1,4],[0,-1,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-3,1;1,-2,2;1,-1,2;2,0,2":[[2,-4,5],[-2,0,4],[1,1,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-3,1;1,-2,2;1,-1,2;2,-4,2;2,0,2":[[-2,0,5],[1,1,4],[0,-1,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-2,2;1,-1,2;1,1,1;2,0,2":[[-2,-2,5],[2,2,4],[1,-3,3]],"B|-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,1,1;2,-1,2;2,0,1;2,2,2":[[-2,-2,5],[3,-1,4],[1,0,3]],"B|-1,-1,2;0,0,1;1,-1,1;2,-2,2":[[2,0,5],[0,-2,4],[1,0,3]],"W|-1,-1,2;0,0,1;1,-1,1;2,-2,2;2,0,1":[[-1,0,5],[0,-2,4],[-2,-1,3]],"B|-1,-1,2;-1,0,2;0,0,1;1,-1,1;2,-2,2;2,0,1":[[3,1,5],[-1,1,4],[0,-2,3]],"W|-1,-1,2;-1,0,2;0,0,1;1,-1,1;2,-2,2;2,0,1;3,1,1":[[0,-2,5],[4,2,4],[-1,1,3]],"B|-1,-1,2;-1,0,2;0,-2,2;0,0,1;1,-1,1;2,-2,2;2,0,1;3,1,1":[[4,2,5],[1,0,4],[-1,1,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,0,1;1,1,1;2,0,1;2,2,2":[[-2,-2,5],[0,2,4],[3,-1,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;-1,1,2;0,0,1;1,1,1;2,0,1;2,2,2":[[0,2,5],[3,-1,4],[1,0,3]],"B|-1,-1,2;0,-2,2;0,0,1;1,-1,1;2,-2,2;2,0,1":[[1,0,5],[-1,0,4],[3,0,3]],"W|-1,-1,2;0,-2,2;0,0,1;1,-1,1;1,0,1;2,-2,2;2,0,1":[[-1,0,5],[3,0,4],[1,-2,3]],"B|-1,-1,2;-1,0,2;0,-2,2;0,0,1;1,-1,1;1,0,1;2,-2,2;2,0,1":[[3,0,5],[3,-1,4],[1,1,3]],"W|-1,-1,2;-1,0,1;0,-2,2;0,0,1;1,-1,1;2,-2,2;2,0,1":[[-2,0,5],[1,0,4],[1,-3,3]],"B|-2,-2,2;-2,0,1;-1,-1,1;0,-2,2;0,0,1;1,-1,2;1,0,1;2,0,2":[[-1,0,5],[-3,0,4],[-1,-3,3]],"B|-2,-1,2;-1,-1,2;0,0,1;1,-1,1;2,-2,2;2,0,1":[[1,0,5],[0,-2,4],[3,1,3]],"W|-2,-1,2;-1,-1,2;0,0,1;1,-1,1;1,0,1;2,-2,2;2,0,1":[[-1,0,5],[3,0,4],[-3,-1,3]],"B|-2,-1,2;-1,-1,2;-1,0,2;0,0,1;1,-1,1;1,0,1;2,-2,2;2,0,1":[[3,0,5],[1,-2,4],[3,1,3]],"W|-2,-1,2;-1,-1,2;0,-2,1;0,0,1;1,-1,1;2,-2,2;2,0,1":[[-1,-3,5],[3,1,4],[-3,-1,3]],"B|-2,-1,2;-1,-3,2;-1,-1,2;0,-2,1;0,0,1;1,-1,1;2,-2,2;2,0,1":[[3,1,5],[0,-1,4],[-1,0,3]],"W|-1,-1,2;0,-2,1;0,0,1;1,-1,1;2,-2,2":[[-1,0,5],[-1,-3,4],[1,-3,3]],"B|-1,-1,2;-1,0,2;0,-2,1;0,0,1;1,-1,1;2,-2,2":[[0,-1,5],[-1,-3,4],[0,-3,3]],"W|-1,-3,1;-1,-1,2;-1,0,2;0,-2,1;0,0,1;1,-1,1;2,-2,2":[[-2,-4,5],[2,0,4],[-1,1,3]],"B|-2,-2,2;-1,-1,1;0,-2,1;0,0,1;1,-3,1;1,-1,2;1,0,2;2,-4,2":[[-2,0,5],[0,-1,4],[1,1,3]],"B|-1,-3,2;-1,-1,2;0,-2,1;0,0,1;1,-1,1;2,-2,2":[[0,-1,5],[-1,0,4],[1,0,3]],"W|-1,-3,2;-1,-1,2;0,-2,1;0,-1,1;0,0,1;1,-1,1;2,-2,2":[[0,-3,5],[0,1,4],[-1,-2,3]],"B|-1,-3,2;-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;1,-1,1;2,-2,2":[[0,1,5],[1,-2,4],[1,-3,3]],"W|-1,-3,2;-1,-1,2;-1,0,1;0,-2,1;0,0,1;1,-1,1;2,-2,2":[[1,0,5],[-1,-2,4],[0,-3,3]],"B|-1,-3,2;-1,-1,2;-1,0,1;0,-2,1;0,0,1;1,-1,1;1,0,2;2,-2,2":[[0,-1,5],[-1,1,4],[-2,0,3]],"B|-1,-1,2;0,-2,1;0,0,1;1,-3,2;1,-1,1;2,-2,2":[[-1,-3,5],[2,0,4],[0,-1,3]],"W|-1,-3,1;-1,-1,2;0,-2,1;0,0,1;1,-3,2;1,-1,1;2,-2,2":[[-2,-4,5],[2,0,4],[0,-4,3]],"B|-2,-2,2;-1,-3,2;-1,-1,1;0,-2,1;0,0,1;1,-3,1;1,-1,2;2,-4,2":[[-2,0,5],[0,-1,4],[0,-4,3]],"W|-1,-1,2;0,-2,1;0,0,1;1,-3,2;1,-1,1;2,-2,2;2,0,1":[[-1,-3,5],[3,1,4],[3,-1,3]],"B|-1,-3,2;-1,-1,2;0,-2,1;0,0,1;1,-3,2;1,-1,1;2,-2,2;2,0,1":[[3,1,5],[0,-3,4],[-1,0,3]],"W|-1,-1,2;0,0,1;1,-1,1;1,0,1;2,-2,2":[[-1,0,5],[2,0,4],[0,-2,3]],"B|-1,-1,2;-1,0,2;0,0,1;1,-1,1;1,0,1;2,-2,2":[[1,-2,5],[1,1,4],[-1,1,3]],"W|-1,-1,2;-1,0,2;0,0,1;1,-2,1;1,-1,1;1,0,1;2,-2,2":[[1,-3,5],[1,1,4],[-1,1,3]],"B|-1,-1,2;-1,0,2;0,0,1;1,-3,2;1,-2,1;1,-1,1;1,0,1;2,-2,2":[[1,1,5],[-1,1,4],[2,-1,3]],"B|-1,-1,2;0,0,1;1,-1,1;1,0,1;2,-2,2;2,0,2":[[1,-2,5],[1,1,4],[2,-1,3]],"W|-1,-1,2;0,0,1;1,-2,1;1,-1,1;1,0,1;2,-2,2;2,0,2":[[1,-3,5],[1,1,4],[2,-1,3]],"B|-1,-1,2;0,0,1;1,-3,2;1,-2,1;1,-1,1;1,0,1;2,-2,2;2,0,2":[[1,1,5],[0,-1,4],[2,-1,3]],"W|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-1,1;1,1,2;2,-2,2":[[2,-1,5],[-2,-1,4],[1,-2,3]],"B|-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-1,1;1,1,2;2,-2,2;2,-1,2":[[-2,-1,5],[1,0,4],[2,0,3]],"B|-1,-1,2;0,-2,2;0,0,1;1,-1,1;1,0,1;2,-2,2":[[2,0,5],[-2,0,4],[2,-1,3]],"W|-1,-1,2;0,-2,1;0,0,1":[[-1,0,5],[-1,-2,4],[0,-1,3],[0,1,2]],"B|-1,-1,2;-1,0,2;0,-2,1;0,0,1":[[0,-1,5],[-1,1,4],[-1,-2,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,0,1;0,2,1":[[1,1,5],[-2,-2,4],[-2,1,3]],"B|-1,-1,1;-1,0,2;-1,1,2;0,0,1;0,2,1;1,1,2":[[0,1,5],[1,2,4],[2,1,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,0,1;0,1,1;0,2,1;1,1,2":[[0,-1,5],[0,3,4],[-1,2,3]],"B|-1,-1,1;-1,0,2;-1,1,2;0,-1,2;0,0,1;0,1,1;0,2,1;1,1,2":[[0,3,5],[0,4,4],[1,-2,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,0,1;0,2,1;1,1,2;1,2,1":[[0,1,5],[-2,1,4],[-1,2,3]],"B|-1,-1,1;-1,0,2;-1,1,2;0,0,1;0,1,2;0,2,1;1,1,2;1,2,1":[[-2,1,5],[2,1,4],[-1,2,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;-1,1,2;0,0,1;0,2,1":[[0,1,5],[1,1,4],[-1,3,3]],"W|-2,-2,2;-1,-1,1;-1,0,2;-1,1,2;0,0,1;0,1,1;0,2,1":[[0,-1,5],[0,3,4],[-1,2,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;-1,1,2;0,-1,2;0,0,1;0,1,1;0,2,1":[[0,3,5],[1,-2,4],[-1,2,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-1,2;1,0,2;1,1,1;2,2,2":[[-2,-2,5],[0,-1,4],[1,-3,3]],"B|-2,-2,2;-1,-1,1;-1,0,2;-1,1,2;0,0,1;0,2,1;1,1,1;2,2,2":[[0,1,5],[-1,3,4],[2,0,3]],"B|-1,-1,1;0,-1,2;0,0,1;1,-2,2;1,-1,2;2,0,1":[[1,1,5],[-2,-2,4],[-1,0,3]],"W|-1,-1,1;0,-1,2;0,0,1;1,-2,2;1,-1,2;1,1,1;2,0,1":[[2,2,5],[-2,-2,4],[-1,0,3]],"B|-1,-1,1;0,-1,2;0,0,1;1,-2,2;1,-1,2;1,1,1;2,0,1;2,2,2":[[-2,-2,5],[3,-1,4],[0,2,3]],"W|-2,-1,2;-2,2,1;-1,-1,2;-1,0,2;-1,1,1;0,-2,1;0,0,1":[[1,-1,5],[-3,3,4],[0,-1,3]],"B|-1,-1,2;0,-2,1;0,0,1;1,-1,2;1,0,2;1,1,1;2,-1,2;2,2,1":[[3,3,5],[0,-1,4],[0,1,3]],"W|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,0,1":[[-2,-1,5],[0,-1,4],[0,1,3]],"B|-2,-1,1;-2,0,1;-1,-2,2;-1,-1,2;0,-1,2;0,0,1":[[-2,1,5],[-2,-3,4],[-1,0,3]],"W|-1,-2,1;0,-2,1;0,0,1;1,-2,1;1,-1,2;1,0,2;2,-1,2":[[2,-2,5],[-2,-2,4],[0,-1,3]],"B|-1,-2,1;0,-2,1;0,0,1;1,-2,1;1,-1,2;1,0,2;2,-2,2;2,-1,2":[[-2,-2,5],[0,1,4],[0,-3,3]],"W|-2,-3,1;-2,-1,1;-2,0,1;-1,-2,2;-1,-1,2;0,-1,2;0,0,1":[[-2,-2,5],[-1,0,4],[-1,-3,3]],"B|-2,-3,1;-2,-2,2;-2,-1,1;-2,0,1;-1,-2,2;-1,-1,2;0,-1,2;0,0,1":[[-1,0,5],[-1,-3,4],[-3,-2,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,-1,2;0,0,1":[[1,-2,5],[1,-1,4],[-2,1,3]],"W|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-2,1":[[2,-2,5],[-2,-2,4],[1,-1,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-2,1;2,-2,2":[[-2,-2,5],[-2,-1,4],[1,-1,3]],"W|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-2,1;1,-1,2;1,0,2":[[-1,-2,5],[-2,-2,4],[2,-1,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-2,2;1,-1,1":[[2,-3,5],[-2,1,4],[-1,1,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,0,1;0,1,2":[[1,-2,5],[-2,-1,4],[-2,-2,3]],"W|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,0,1;0,1,2;1,-2,1":[[2,-2,5],[-2,-2,4],[-2,-1,3]],"B|-1,-2,1;-1,-1,2;-1,0,2;0,-2,1;0,0,1;0,1,2;1,-2,1;2,-2,2":[[-2,-2,5],[-2,-1,4],[0,-1,3]],"W|-1,0,2;0,-1,2;0,0,1;1,-2,1;1,-1,2;2,-1,1;2,0,1":[[3,0,5],[-1,-1,4],[1,0,3]],"B|-1,0,2;0,-1,2;0,0,1;1,-2,1;1,-1,2;2,-1,1;2,0,1;3,0,2":[[2,-2,5],[2,1,4],[0,-3,3]],"B|-1,-2,2;-1,-1,2;0,-2,1;0,0,1":[[0,-1,5],[-1,-3,4],[-1,0,3]],"W|-1,-2,2;-1,-1,2;0,-2,1;0,-1,1;0,0,1":[[0,-3,5],[0,1,4],[-1,0,3]],"B|-1,-2,2;-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1":[[0,1,5],[-1,0,4],[-1,-3,3]],"W|-1,-2,2;-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,1":[[0,2,5],[-1,0,4],[-1,-3,3]],"B|-1,-2,2;-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,1;0,2,2":[[-1,0,5],[1,-4,4],[-2,-1,3]],"W|-1,-2,2;-1,-1,2;-1,0,1;0,-3,2;0,-2,1;0,-1,1;0,0,1":[[1,-4,5],[-2,-1,4],[0,1,3]],"B|-1,-2,2;-1,-1,2;-1,0,1;0,-3,2;0,-2,1;0,-1,1;0,0,1;1,-4,2":[[0,1,5],[-2,-1,4],[2,-5,3]],"B|-1,-2,2;-1,-1,2;0,-2,1;0,-1,1;0,0,1;0,1,2":[[0,-3,5],[0,-4,4],[-1,-3,3]],"W|-1,-2,2;-1,-1,2;0,-3,1;0,-2,1;0,-1,1;0,0,1;0,1,2":[[0,-4,5],[-1,0,4],[-1,-3,3]],"B|-1,-2,2;-1,-1,2;0,-4,2;0,-3,1;0,-2,1;0,-1,1;0,0,1;0,1,2":[[-1,0,5],[-1,-3,4],[-1,1,3]],"W|-1,-2,2;-1,-1,2;0,-4,1;0,-2,1;0,-1,1;0,0,1;0,1,2":[[0,-3,5],[-1,0,4],[-1,-3,3]],"B|-1,-2,2;-1,-1,2;0,-4,1;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,2":[[-1,0,5],[-1,-3,4],[1,-4,3]],"W|-1,-3,1;-1,-2,2;-1,-1,2;0,-2,1;0,0,1":[[-2,-1,5],[1,-1,4],[-2,-4,3]],"B|-2,-1,2;-1,-3,1;-1,-2,2;-1,-1,2;0,-2,1;0,0,1":[[1,-1,5],[-2,-4,4],[0,-3,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-3,1;1,-2,2;1,-1,2;2,-1,2":[[2,-4,5],[-2,0,4],[0,-3,3]],"B|-1,-1,1;0,-2,1;0,0,1;1,-3,1;1,-2,2;1,-1,2;2,-4,2;2,-1,2":[[-2,0,5],[-2,-2,4],[1,1,3]],"W|-2,-4,1;-2,-1,2;-1,-3,1;-1,-2,2;-1,-1,2;0,-2,1;0,0,1":[[1,-1,5],[-3,-5,4],[0,-1,3]],"B|-1,-1,2;0,-2,1;0,0,1;1,-3,1;1,-2,2;1,-1,2;2,-4,1;2,-1,2":[[3,-5,5],[0,-1,4],[0,-3,3]],"B|-1,-1,2;0,-2,1;0,0,1;1,-3,1;1,-2,2;1,-1,2":[[0,-1,5],[-1,0,4],[-2,-1,3]],"W|-1,-1,2;0,-2,1;0,-1,1;0,0,1;1,-3,1;1,-2,2;1,-1,2":[[0,-3,5],[0,1,4],[1,0,3]],"B|-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;1,-3,1;1,-2,2;1,-1,2":[[0,1,5],[1,0,4],[-1,-4,3]],"W|-1,-1,2;-1,0,1;0,-2,1;0,0,1;1,-3,1;1,-2,2;1,-1,2":[[0,-1,5],[2,-1,4],[1,0,3]],"B|-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1;1,-3,1;1,-2,2;1,-1,2":[[2,-1,5],[-2,-1,4],[1,0,3]],"B|-2,-4,2;-1,-3,1;-1,-2,2;-1,-1,2;0,-2,1;0,0,1":[[0,-1,5],[1,-1,4],[-1,1,3]],"W|-2,-4,2;-1,-3,1;-1,-2,2;-1,-1,2;0,-2,1;0,-1,1;0,0,1":[[0,-3,5],[0,1,4],[-1,0,3]],"B|-2,-4,2;-1,-3,1;-1,-2,2;-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1":[[0,1,5],[-1,0,4],[1,-1,3]],"W|-1,-1,1;0,-2,1;0,0,1;1,-3,1;1,-2,2;1,-1,2;2,-4,2":[[-2,0,5],[0,-1,4],[-2,-2,3]],"B|-2,-4,2;-1,-3,1;-1,-2,2;-1,-1,2;0,-2,1;0,0,1;1,-1,1;2,0,2":[[0,-1,5],[2,-2,4],[-1,1,3]],"W|-1,-2,2;-1,-1,2;-1,0,1;0,-2,1;0,0,1":[[-2,-1,5],[0,-1,4],[0,-3,3]],"B|-2,-1,2;-1,-2,2;-1,-1,2;-1,0,1;0,-2,1;0,0,1":[[1,0,5],[-3,0,4],[0,-1,3]],"W|-1,0,1;0,-2,1;0,0,1;1,-2,2;1,-1,2;1,0,1;2,-1,2":[[2,0,5],[-2,0,4],[0,-1,3]],"B|-1,0,1;0,-2,1;0,0,1;1,-2,2;1,-1,2;1,0,1;2,-1,2;2,0,2":[[-2,0,5],[0,-3,4],[0,1,3]],"W|-2,-1,2;-2,0,1;-1,-2,2;-1,-1,2;0,-3,1;0,-1,1;0,0,1":[[0,-2,5],[-1,0,4],[-1,-3,3]],"B|-2,-1,2;-2,0,1;-1,-2,2;-1,-1,2;0,-3,1;0,-2,2;0,-1,1;0,0,1":[[-1,0,5],[1,-2,4],[-1,-3,3]],"B|-1,-2,2;-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1":[[1,0,5],[1,-1,4],[-3,0,3]],"W|-1,-2,2;-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1;1,0,1":[[2,0,5],[-2,0,4],[1,-1,3]],"B|-1,-2,2;-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1;1,0,1;2,0,2":[[-2,0,5],[-2,-1,4],[1,-1,3]],"W|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-2,2;1,-1,2;1,0,1":[[-1,0,5],[3,-4,4],[-2,0,3]],"B|-1,-1,1;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-2,2;1,-1,2;1,0,1":[[2,-3,5],[-2,1,4],[1,-3,3]],"B|-1,-2,2;-1,-1,2;-1,0,1;0,-3,2;0,-2,1;0,0,1":[[1,0,5],[-2,-1,4],[-2,0,3]],"W|-1,-2,2;-1,-1,2;-1,0,1;0,-3,2;0,-2,1;0,0,1;1,0,1":[[2,0,5],[-2,0,4],[-2,-1,3]],"B|-1,-2,2;-1,-1,2;-1,0,1;0,-3,2;0,-2,1;0,0,1;1,0,1;2,0,2":[[-2,0,5],[0,-1,4],[-2,-1,3]],"W|-2,-1,1;-1,-2,2;-1,-1,2;-1,0,1;0,-3,2;0,-2,1;0,0,1":[[0,1,5],[-1,-3,4],[0,-1,3]],"B|-1,0,2;0,-1,1;0,0,1;1,-2,1;1,-1,2;2,-1,2;2,0,1;3,0,2":[[0,-2,5],[0,1,4],[2,-3,3]],"B|-1,-1,2;0,-2,1;0,-1,2;0,0,1":[[1,-1,5],[-1,0,4],[-1,-2,3]],"W|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-1,2":[[1,-2,5],[-2,0,4],[1,1,3]],"B|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-2,2;1,-1,2":[[1,-3,5],[1,1,4],[-1,0,3]],"W|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-3,1;1,-2,2;1,-1,2":[[2,-4,5],[-2,0,4],[-1,0,3]],"B|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-3,1;1,-2,2;1,-1,2;2,-4,2":[[-2,0,5],[-2,-2,4],[1,1,3]],"W|-1,-1,1;-1,1,2;-1,2,2;0,0,1;0,1,2;0,2,1;1,1,1":[[2,2,5],[-2,-2,4],[-1,3,3]],"B|-1,-1,1;-1,1,2;-1,2,2;0,0,1;0,1,2;0,2,1;1,1,1;2,2,2":[[-2,-2,5],[-1,3,4],[1,0,3]],"B|-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-1,1;2,0,2":[[2,-2,5],[-1,1,4],[-1,-3,3]],"W|-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-1,1;2,-2,1;2,0,2":[[3,-3,5],[-1,1,4],[1,-2,3]],"B|-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-1,1;2,-2,1;2,0,2;3,-3,2":[[-1,1,5],[1,-2,4],[-1,-2,3]],"W|-1,-1,1;-1,1,2;0,0,1;0,1,2;0,2,1;1,1,1;2,0,2":[[2,2,5],[-2,-2,4],[-1,2,3]],"B|-1,-1,1;-1,1,2;0,0,1;0,1,2;0,2,1;1,1,1;2,0,2;2,2,2":[[-2,-2,5],[2,1,4],[1,0,3]],"B|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-1,2;1,1,2":[[1,-3,5],[-2,0,4],[-1,0,3]],"W|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-3,1;1,-1,2;1,1,2":[[2,-4,5],[-2,0,4],[1,0,3]],"B|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-3,1;1,-1,2;1,1,2;2,-4,2":[[-2,0,5],[1,-2,4],[1,0,3]],"W|-1,-1,2;-1,1,2;0,-2,1;0,-1,2;0,0,1;1,-1,1;2,0,1":[[-1,-3,5],[3,1,4],[-1,0,3]],"B|-1,-1,2;-1,1,2;-1,3,2;0,0,1;0,1,2;0,2,1;1,1,1;2,0,1":[[3,-1,5],[-1,0,4],[3,0,3]],"W|-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1":[[1,-1,5],[-2,-1,4],[1,0,3]],"B|-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1;1,-1,2":[[-2,-1,5],[2,-1,4],[1,0,3]],"W|-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,-1,1":[[-2,-1,5],[-1,0,4],[0,1,3]],"B|-2,-1,1;-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1;1,-1,2;2,-1,2":[[3,-1,5],[1,0,4],[-2,0,3]],"W|-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1;1,-1,2;2,-1,1":[[-2,-1,5],[1,0,4],[-2,0,3]],"B|-2,-1,1;-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,-1,2":[[3,-1,5],[-1,0,4],[2,0,3]],"B|-2,-1,2;-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1":[[1,-1,5],[-3,-1,4],[1,0,3]],"W|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,-1,2":[[3,-1,5],[-1,0,4],[2,0,3]],"B|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,-1,2;3,-1,2":[[4,-1,5],[-1,0,4],[2,0,3]],"W|-2,0,1;-1,-3,1;-1,-2,2;-1,-1,2;-1,0,2;0,-1,1;0,0,1":[[-1,1,5],[0,1,4],[0,-2,3]],"B|-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,-1,2;3,-1,1":[[-2,-1,5],[2,0,4],[-1,0,3]],"B|-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1;1,0,2":[[1,-1,5],[-1,-2,4],[-2,-1,3]],"W|-1,-1,1;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-1,2;1,0,1":[[1,-2,5],[-2,1,4],[1,1,3]],"W|-1,-2,1;-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1;1,0,2":[[1,-1,5],[-2,-1,4],[2,-1,3]],"B|-1,-1,2;-1,0,2;0,-2,1;0,-1,2;0,0,1;1,-2,1;1,-1,2;1,0,1":[[2,-1,5],[-2,-1,4],[-1,-2,3]],"W|-1,-2,1;-1,-1,2;0,-2,1;0,-1,2;0,0,1":[[1,-1,5],[-2,-1,4],[1,-2,3]],"B|-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-2,1;1,-1,2":[[2,-1,5],[-2,-1,4],[-1,-2,3]],"W|-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-2,1;1,-1,2;2,-1,1":[[-2,-1,5],[-1,-2,4],[3,0,3]],"B|-2,-1,1;-1,-2,1;-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-1,2;2,-1,2":[[3,-1,5],[1,-2,4],[-2,-2,3]],"W|-1,-2,1;-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-1,2;2,-1,1":[[-2,-1,5],[-3,-1,4],[1,-2,3]],"B|-2,-1,1;-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-2,1;1,-1,2;2,-1,2":[[3,-1,5],[-1,-2,4],[2,-2,3]],"B|-2,-1,1;-2,0,1;-1,-2,2;-1,-1,2;-1,0,2;0,0,1":[[-1,1,5],[-1,-3,4],[-2,1,3]],"W|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-2,1;1,-1,2;2,-1,2":[[3,-1,5],[2,-2,4],[-1,-2,3]],"B|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-2,1;1,-1,2;2,-1,2;3,-1,2":[[4,-1,5],[-1,-2,4],[2,-2,3]],"W|-2,-1,1;-2,0,1;-1,-3,1;-1,-2,2;-1,-1,2;-1,0,2;0,0,1":[[-1,1,5],[-2,1,4],[-2,-2,3]],"B|-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-2,1;1,-1,2;2,-1,2;3,-1,1":[[-2,-1,5],[2,-2,4],[-1,-2,3]],"B|-1,-2,1;-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-2,2":[[1,-1,5],[-1,0,4],[-2,-1,3]],"W|-1,-2,1;-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-2,2;1,-1,1":[[-1,0,5],[2,-3,4],[-1,1,3]],"W|-1,-2,1;-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1;1,-2,2":[[1,-1,5],[-2,-1,4],[2,-1,3]],"B|-1,-2,1;-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1;1,-2,2;1,-1,2":[[-2,-1,5],[2,-1,4],[1,0,3]],"B|-1,-1,2;0,-2,1;0,0,1;0,1,2":[[1,-1,5],[-1,-2,4],[0,-1,3]],"W|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-1,2":[[1,1,5],[-2,0,4],[1,0,3]],"B|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-1,2;1,1,2":[[1,-3,5],[-2,0,4],[-1,0,3]],"W|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-3,1;1,-1,2;1,1,2":[[2,-4,5],[-2,0,4],[1,0,3]],"B|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-3,1;1,-1,2;1,1,2;2,-4,2":[[-2,0,5],[1,0,4],[2,1,3]],"W|-1,-1,2;-1,0,2;0,0,1;0,2,1;1,-1,2;1,1,1;2,0,1":[[3,-1,5],[-1,3,4],[0,-1,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,2,1;1,-1,2;1,1,1;2,0,1;3,-1,2":[[-1,3,5],[0,-1,4],[0,3,3]],"B|-1,-1,2;0,-2,1;0,0,1;0,1,2;1,-1,1;2,0,2":[[-1,1,5],[2,-2,4],[0,-1,3]],"W|-1,-1,1;-1,0,2;0,0,1;0,2,2;1,-1,2;1,1,1;2,0,1":[[2,2,5],[-2,-2,4],[2,-1,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,2,2;1,-1,2;1,1,1;2,0,1;2,2,2":[[-2,-2,5],[1,2,4],[0,1,3]],"W|-1,-1,2;0,-2,1;0,0,1;0,1,2;1,-1,1;2,-2,1;2,0,2":[[-1,1,5],[3,-3,4],[1,-2,3]],"B|-1,-1,2;-1,0,2;0,0,1;0,2,2;1,-1,2;1,1,1;2,0,1;2,2,1":[[3,3,5],[2,-1,4],[2,3,3]],"B|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-1,2;1,0,2":[[1,1,5],[1,-3,4],[-1,-2,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,-1,2;0,0,1;0,2,1;1,1,1":[[2,2,5],[-2,-2,4],[-2,1,3]],"B|-1,-1,1;-1,0,2;-1,1,2;0,-1,2;0,0,1;0,2,1;1,1,1;2,2,2":[[-2,-2,5],[-1,3,4],[2,0,3]],"W|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-3,1;1,-1,2;1,0,2":[[2,-4,5],[-2,0,4],[1,1,3]],"B|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-3,1;1,-1,2;1,0,2;2,-4,2":[[1,1,5],[-2,0,4],[-1,-2,3]],"W|-1,-2,1;-1,-1,2;0,-2,1;0,0,1;0,1,2":[[-2,-1,5],[-1,0,4],[1,0,3]],"B|-1,0,2;0,0,1;1,-2,2;1,-1,2;2,-1,1;2,0,1":[[2,1,5],[0,-1,4],[1,0,3]],"W|-1,-2,1;0,-2,1;0,0,1;0,1,2;1,-2,1;1,-1,2;2,-1,2":[[2,-2,5],[-2,-2,4],[0,-1,3]],"B|-1,-2,1;0,-2,1;0,0,1;0,1,2;1,-2,1;1,-1,2;2,-2,2;2,-1,2":[[-2,-2,5],[-1,-1,4],[1,0,3]],"W|-1,0,2;0,-1,1;0,0,1;1,-2,2;1,-1,2;2,-1,1;2,0,1":[[1,0,5],[1,-3,4],[2,-2,3]],"B|-1,0,2;0,-1,1;0,0,1;1,-2,2;1,-1,2;1,0,2;2,-1,1;2,0,1":[[1,1,5],[1,-3,4],[2,-2,3]],"B|-1,-2,1;-1,-1,2;0,-2,1;0,0,1;0,1,2;1,0,2":[[1,-2,5],[-2,-2,4],[2,-1,3]],"W|-1,-2,1;-1,-1,2;0,-2,1;0,0,1;0,1,2;1,-2,1;1,0,2":[[2,-2,5],[-2,-2,4],[2,-1,3]],"B|-1,-2,1;-1,-1,2;0,-2,1;0,0,1;0,1,2;1,-2,1;1,0,2;2,-2,2":[[-2,-2,5],[2,-1,4],[-1,2,3]],"W|-1,0,2;0,-1,2;0,0,1;0,2,1;1,1,2;1,2,1;2,2,1":[[3,2,5],[-1,2,4],[-2,1,3]],"B|-1,0,2;0,-1,2;0,0,1;0,2,1;1,1,2;1,2,1;2,2,1;3,2,2":[[-1,2,5],[2,1,4],[0,1,3]],"W|-1,-1,2;0,-2,1;0,-1,1;0,0,1;0,1,2":[[0,-4,5],[0,-3,4],[-1,0,3]],"B|-1,-1,2;0,-4,2;0,-2,1;0,-1,1;0,0,1;0,1,2":[[1,-1,5],[1,-2,4],[1,0,3]],"W|-1,-1,1;0,-4,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-1,2":[[1,1,5],[1,-3,4],[1,0,3]],"B|-1,-1,1;0,-4,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-1,2;1,1,2":[[1,-3,5],[-2,0,4],[-1,0,3]],"W|-1,-1,2;0,-4,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-2,1":[[-1,0,5],[1,0,4],[2,-2,3]],"B|-1,-1,2;-1,0,2;0,-4,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-2,1":[[-1,-2,5],[2,-2,4],[1,0,3]],"B|-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,2":[[1,-1,5],[1,-2,4],[1,0,3]],"W|-1,-1,1;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-1,2":[[1,1,5],[1,-3,4],[1,-2,3]],"B|-1,-1,1;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-1,2;1,1,2":[[1,-3,5],[-2,0,4],[-1,0,3]],"W|-1,-1,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-2,1":[[-1,0,5],[1,0,4],[-1,-2,3]],"B|-1,-1,2;-1,0,2;0,-3,2;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-2,1":[[-1,-2,5],[-1,1,4],[-2,-1,3]],"W|-1,-1,2;-1,0,1;0,0,1":[[-2,0,5],[0,-1,4],[1,0,3],[0,1,2]],"B|-1,-1,2;0,-2,2;0,-1,1;0,0,1":[[-2,0,5],[1,-3,4],[1,0,3]],"W|-2,0,1;-1,-1,2;0,-2,2;0,-1,1;0,0,1":[[-1,0,5],[1,-2,4],[1,0,3]],"B|-2,0,1;-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1":[[-1,1,5],[-1,-2,4],[0,1,3]],"W|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,0,2":[[1,1,5],[2,-1,4],[-2,0,3]],"B|-1,-1,1;0,-2,1;0,-1,2;0,0,1;1,-1,2;1,0,1;1,1,2;2,0,2":[[1,-3,5],[-2,0,4],[-1,0,3]],"W|-2,-1,1;-2,0,2;-1,-1,2;-1,0,1;0,-2,1;0,-1,2;0,0,1":[[1,-1,5],[0,1,4],[-3,-1,3]],"B|-1,-1,2;0,-2,1;0,-1,2;0,0,1;1,-1,2;1,0,1;2,-1,1;2,0,2":[[3,-2,5],[0,1,4],[-2,-1,3]],"B|-1,-2,2;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,1":[[1,0,5],[-1,0,4],[-2,-2,3]],"W|-1,-2,2;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,1;2,0,1":[[-1,0,5],[3,0,4],[1,-2,3]],"B|-1,-2,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,1;2,0,1":[[3,0,5],[0,1,4],[-1,-1,3]],"W|-1,-2,2;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,1":[[1,0,5],[1,-2,4],[-2,-2,3]],"B|-1,-2,2;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,2;2,0,1":[[1,-2,5],[0,1,4],[2,1,3]],"B|-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,1":[[1,0,5],[1,1,4],[2,1,3]],"W|-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,1;2,0,1":[[3,0,5],[-1,-2,4],[2,1,3]],"B|-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,1;2,0,1;3,0,2":[[2,1,5],[-1,-2,4],[0,1,3]],"W|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-1,2;1,0,1;2,0,2":[[1,1,5],[2,-1,4],[-2,0,3]],"B|-1,-1,1;0,-2,1;0,0,1;0,1,2;1,-1,2;1,0,1;1,1,2;2,0,2":[[1,-3,5],[-2,0,4],[-1,0,3]],"W|-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,-3,1":[[-1,-2,5],[-1,-3,4],[-2,0,3]],"B|-1,-2,2;-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,-3,1":[[1,-2,5],[1,-1,4],[-1,0,3]],"W|-1,-2,2;-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,-3,1;1,-2,1":[[-1,0,5],[2,-3,4],[1,-1,3]],"B|-1,-2,2;-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-3,1;1,-2,1":[[-1,-3,5],[-1,1,4],[1,-1,3]],"W|-1,-2,2;-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,-3,1;1,-1,1":[[-1,-3,5],[-1,1,4],[-1,0,3]],"B|-1,-3,1;-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-3,2;1,-2,2;1,-1,2":[[1,0,5],[1,-4,4],[-1,-2,3]],"B|-1,-3,1;0,-2,2;0,-1,1;0,0,1;1,-3,2;1,-1,2":[[-1,0,5],[-1,-1,4],[1,0,3]],"W|-1,-3,1;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-3,2;1,-1,2":[[-2,0,5],[2,-4,4],[1,-2,3]],"B|-1,-3,2;-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,-3,1;1,0,1;2,0,2":[[1,-1,5],[-1,-2,4],[2,1,3]],"W|-1,-3,1;-1,-1,1;0,-2,2;0,-1,1;0,0,1;1,-3,2;1,-1,2":[[1,-2,5],[1,-4,4],[1,0,3]],"B|-1,-3,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,2":[[3,1,5],[-1,-2,4],[1,-2,3]],"W|-1,-3,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,2;3,1,1":[[1,-2,5],[1,1,4],[1,-3,3]],"B|-1,-3,1;0,-2,2;0,-1,1;0,0,1;1,-2,2;1,-1,2;2,0,2;3,1,1":[[-1,-2,5],[-1,-1,4],[1,0,3]],"W|-1,-3,1;-1,-2,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,2":[[3,1,5],[-1,-1,4],[-1,-4,3]],"B|-1,-3,1;-1,-2,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,2;3,1,2":[[4,2,5],[-1,-1,4],[-2,-3,3]],"W|-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,0,1":[[-2,0,5],[-1,-2,4],[1,-3,3]],"B|-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,2":[[-1,-3,5],[3,1,4],[1,-2,3]],"W|-1,-3,1;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,2":[[3,1,5],[1,-2,4],[1,-3,3]],"B|-1,-3,1;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,2;3,1,2":[[4,2,5],[1,-2,4],[-2,0,3]],"W|-1,-3,1;0,-2,2;0,0,1;0,1,1;1,-1,2;1,0,1;2,0,2":[[3,1,5],[2,-1,4],[-1,2,3]],"B|-1,-3,1;0,-2,2;0,0,1;0,1,1;1,-1,2;1,0,1;2,0,2;3,1,2":[[4,2,5],[2,-1,4],[0,2,3]],"B|-1,-2,2;-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,0,1":[[1,-2,5],[-1,0,4],[-2,0,3]],"W|-1,-2,1;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-2,2;1,-1,2":[[1,0,5],[2,0,4],[-1,-3,3]],"B|-1,-2,1;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-2,2;1,-1,2;1,0,2":[[1,-3,5],[1,1,4],[-1,-1,3]],"W|-1,-2,2;-1,-1,2;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,0,1":[[-2,0,5],[2,0,4],[1,-2,3]],"B|-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-2,2;1,-1,2;1,0,1;2,0,2":[[-2,0,5],[-1,-3,4],[3,1,3]],"B|-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,-3,2;1,0,1":[[-2,0,5],[2,-4,4],[-1,0,3]],"W|-1,-3,2;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,1":[[-2,-4,5],[1,0,4],[1,-2,3]],"B|-2,-4,2;-1,-3,2;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,1":[[1,0,5],[-2,0,4],[3,0,3]],"W|-1,-1,2;0,-2,2;0,-1,1;0,0,1;1,-3,2;1,0,1;2,-4,1":[[-2,0,5],[-1,-2,4],[2,1,3]],"B|-2,-4,1;-1,-3,2;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-1,2;2,0,2":[[3,1,5],[1,-2,4],[-2,0,3]],"B|-1,-1,2;-1,0,1;0,0,1;1,0,2":[[0,-1,5],[0,1,4],[1,-1,3]],"W|-1,-1,2;-1,0,1;0,-1,1;0,0,1;0,1,2":[[1,0,5],[-2,0,4],[-2,1,3]],"B|-1,-1,2;-1,0,1;0,-1,1;0,0,1;0,1,2;1,0,2":[[-2,1,5],[1,-2,4],[-1,2,3]],"W|-1,-1,2;-1,0,1;0,-1,1;0,0,1;0,1,2;1,-2,1;1,0,2":[[2,-3,5],[-2,1,4],[2,-1,3]],"B|-1,-1,2;-1,0,1;0,-1,1;0,0,1;0,1,2;1,-2,1;1,0,2;2,-3,2":[[-2,1,5],[2,-1,4],[1,-1,3]],"B|-1,-1,2;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,0,2":[[1,-2,5],[-2,1,4],[-2,0,3]],"W|-1,-1,2;-1,0,1;0,-2,2;0,-1,1;0,0,1;1,-2,1;1,0,2":[[-2,1,5],[2,-3,4],[-2,0,3]],"B|-1,-2,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,1;2,1,2":[[-2,-3,5],[2,0,4],[-1,-3,3]],"W|-1,-2,1;0,-1,1;0,0,1;0,1,2;1,-1,2;1,0,1;2,0,2":[[2,1,5],[-2,-3,4],[0,-2,3]],"B|-1,-2,1;0,-1,1;0,0,1;0,1,2;1,-1,2;1,0,1;2,0,2;2,1,2":[[-2,-3,5],[3,1,4],[0,-2,3]],"B|-1,-1,2;-1,0,1;0,-1,1;0,0,1;1,-2,2;1,0,2":[[0,1,5],[0,-2,4],[1,-1,3]],"W|-1,-1,2;-1,0,1;0,-1,1;0,0,1;0,1,1;1,-2,2;1,0,2":[[0,-2,5],[0,2,4],[1,-1,3]],"B|-1,-1,2;-1,0,1;0,-2,2;0,-1,1;0,0,1;0,1,1;1,-2,2;1,0,2":[[0,2,5],[1,2,4],[-2,-1,3]],"W|-1,-1,2;-1,0,1;0,-2,1;0,-1,1;0,0,1;1,-2,2;1,0,2":[[0,1,5],[0,-3,4],[1,-1,3]],"B|-1,-1,2;-1,0,1;0,-2,1;0,-1,1;0,0,1;0,1,2;1,-2,2;1,0,2":[[0,-3,5],[1,-1,4],[-1,2,3]],"W|-1,-1,2;-1,0,1;0,0,1;0,1,1;1,0,2":[[0,-1,5],[0,2,4],[-2,0,3]],"B|-1,-1,2;-1,0,1;0,-1,2;0,0,1;0,1,1;1,0,2":[[-2,-1,5],[1,-1,4],[-1,1,3]],"W|-1,-1,1;-1,0,2;-1,1,2;0,-1,2;0,0,1;0,1,1;1,0,1":[[1,-2,5],[-2,1,4],[-3,2,3]],"B|-1,-1,1;-1,0,2;-1,1,2;0,-1,2;0,0,1;0,1,1;1,-2,2;1,0,1":[[2,-3,5],[-2,1,4],[1,1,3]],"B|-1,-1,2;-1,0,1;0,0,1;0,1,1;0,2,2;1,0,2":[[-2,-1,5],[1,2,4],[0,-1,3]],"W|-1,-2,1;-1,-1,2;0,-1,1;0,0,1;0,1,2;1,0,1;2,0,2":[[2,1,5],[-2,-3,4],[1,1,3]],"B|-1,-2,1;-1,-1,2;0,-1,1;0,0,1;0,1,2;1,0,1;2,0,2;2,1,2":[[-2,-3,5],[-3,-4,4],[1,-1,3]],"W|-1,-1,2;-1,0,1;0,0,1;0,1,1;0,2,2;1,0,2;1,2,1":[[-2,-1,5],[2,3,4],[0,-1,3]],"B|-1,-2,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,0,1;1,1,2;2,1,2":[[-2,-3,5],[0,1,4],[2,-1,3]],"B|-1,-1,2;0,-2,2;0,-1,1;0,0,1;0,1,2;1,0,1":[[-1,-2,5],[2,0,4],[2,1,3]],"W|-1,-2,1;-1,-1,2;0,-2,2;0,-1,1;0,0,1;0,1,2;1,0,1":[[-2,-3,5],[2,1,4],[1,-3,3]],"B|-1,0,1;0,-1,2;0,0,1;0,1,1;0,2,2;1,1,2;1,2,1;2,3,2":[[-2,-1,5],[-2,0,4],[2,0,3]],"W|-1,-1,2;0,-2,2;0,-1,1;0,0,1;0,1,2;1,0,1;2,0,1":[[-1,0,5],[3,0,4],[1,-3,3]],"B|-1,-1,2;-1,0,2;0,-2,2;0,-1,1;0,0,1;0,1,2;1,0,1;2,0,1":[[-1,-2,5],[3,0,4],[-1,1,3]],"W|-1,-1,1;-1,0,2;0,0,1;1,-1,2;1,0,1":[[0,-1,5],[0,1,4],[1,1,3]],"B|-1,-1,1;-1,0,2;-1,1,2;0,-1,2;0,0,1;0,1,1":[[-2,-2,5],[1,1,4],[1,-2,3]],"W|-1,-1,2;-1,0,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,1":[[3,-3,5],[-1,1,4],[2,1,3]],"B|-1,-1,2;-1,0,1;0,-1,2;0,0,1;1,-1,1;1,0,2;2,-2,1;3,-3,2":[[-1,1,5],[2,1,4],[-1,-2,3]],"W|-1,-1,1;-1,0,1;-1,1,2;0,0,1;0,1,2;1,0,2;1,1,1":[[-2,-2,5],[2,2,4],[2,-1,3]],"B|-1,-1,1;-1,0,2;-1,1,2;0,-1,2;0,0,1;0,1,1;1,1,1;2,2,2":[[-2,-2,5],[1,-2,4],[-2,1,3]],"B|-1,-1,1;-1,0,2;0,0,1;0,1,2;1,-1,2;1,0,1":[[1,1,5],[-2,-2,4],[-2,-1,3]],"W|-1,-1,2;-1,0,1;0,0,1;0,1,2;1,-1,1;1,0,2;2,-2,1":[[-1,1,5],[3,-3,4],[2,-1,3]],"B|-1,-1,2;-1,0,1;-1,1,2;0,-1,2;0,0,1;1,0,2;1,1,1;2,2,1":[[3,3,5],[2,1,4],[-2,-1,3]],"B|-1,-1,1;-1,0,2;0,0,1;1,-1,2;1,0,1;1,1,2":[[0,1,5],[0,-1,4],[0,-2,3]],"W|-1,-1,1;-1,0,2;0,0,1;0,1,1;1,-1,2;1,0,1;1,1,2":[[0,-1,5],[0,2,4],[2,0,3]],"B|-1,-1,1;-1,0,2;-1,1,2;0,-1,2;0,0,1;0,1,1;1,0,1;1,1,2":[[-1,2,5],[2,-1,4],[1,-2,3]],"W|-1,-1,1;-1,0,1;-1,1,2;0,-1,2;0,0,1;0,1,1;1,1,2":[[-2,0,5],[1,0,4],[0,2,3]],"B|-1,-1,1;-1,0,2;0,-2,2;0,-1,1;0,0,1;1,-1,2;1,0,1;1,1,2":[[2,1,5],[-1,-2,4],[2,0,3]]};

/* ---------------- 五、对外接口 ---------------- */
  return {
    /* 常量 */
    EMPTY, BLACK, WHITE, DIRECTIONS,
    LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD,
    AI_COLOR: WHITE,
    SEARCH_DEPTH, CANDIDATE_LIMIT, ROOT_CANDIDATE_LIMIT, SEARCH_BUDGET_MS,
    MEDIUM_SEARCH_DEPTH, MEDIUM_SEARCH_BUDGET_MS, HINT_RADIUS, WIN_SCORE, LIVE_THREE_SCORE,
    TT_MAX_ENTRIES, TT_EXACT, TT_LOWER, TT_UPPER, TT_SIDE_ME, TT_SIDE_OPP,
    TT_PERSP_BLACK, TT_PERSP_WHITE,
    VCF_MAX_PLIES, VCF_NODE_LIMIT, VCF_TIME_BUDGET_MS,
    VCT_MAX_PLIES, VCT_NODE_LIMIT, VCT_TIME_BUDGET_MS,
    OPENING_TOTAL_MOVES, OPENING_DOUBLE_BONUS, OPENING_BOOK_MAX_STONES,
    CONNECT_BONUS, CENTER_WEIGHT, DOUBLE_THREAT_BONUS, TEMPO_BONUS,
    PATTERN_TABLE,

    /* 状态访问 */
    get board() { return board; },
    get boardSize() { return boardSize; },
    get playerColor() { return playerColor; },
    get aiColor() { return aiColor; },
    get moveVariety() { return moveVariety; },
    get lastVcfPath() { return lastVcfPath; },
    get lastVctPath() { return lastVctPath; },

    /* 配置 */
    /** 重建 n×n 棋盘并清空。
     *  ★ 刻意“原地”改写已有数组：若替换成新数组，任何缓存过 AI.board 的调用方
     *    （测试、基准、外部工具）都会变成持有孤儿数组——引擎读到空盘、却仍返回
     *    看似合法的点，从而产生极隐蔽的错误结论。原地清空可彻底避免这类陷阱。 */
    setBoardSize(n) {
      boardSize = n;
      resetState();
      if (!Array.isArray(board) || board.length !== n) {
        board = Array.from({ length: n }, () => Array(n).fill(EMPTY));
      } else {
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) board[r][c] = EMPTY;
      }
      return board;
    },
    /** 只改尺寸并清空（与 setBoardSize 的区别仅在于是否重置搜索缓存） */
    resizeBoard(n) {
      boardSize = n;
      if (!Array.isArray(board) || board.length !== n) {
        board = Array.from({ length: n }, () => Array(n).fill(EMPTY));
      } else {
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) board[r][c] = EMPTY;
      }
      return board;
    },
    setColors(me, opp) { playerColor = me; aiColor = opp; },
    setMoveVariety(v) { moveVariety = v; },

    /* 决策与查询 */
    getBestMove, bestBySearch, bestByScore, searchDepth, inBoard,
    findImmediateWin, threatLevel, countThreats, canWinNow, scoreFor,
    evaluateBoard, evaluateCell, lineInfo, lineScore,
    getCandidateMoves, forcingMovesOf, resolveThreats,
    findVcfWin, findVctWin, findDoubleThreat, findDoubleKill, findOpponentDoubleThreat,
    pickVaried, pickTopN, bookMove, openingMove,
    /* 测试与调试用的内部函数（保持与旧测试脚本一致的可调用面） */
    comboBonus, threatSpaceBonus, directionScore, initSearchTables, hashXor,
  };

  /* 换局/换棋盘时清空搜索缓存，避免旧局面数据串味 */
  function resetState() {
    searchState = null;
    lastVcfPath = null;
    lastVctPath = null;
    ttMap = null;
    historyTable = null;
    killerTable = null;
    boardHash = 0;
  }
});
