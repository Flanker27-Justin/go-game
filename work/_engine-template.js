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
@@CONSTS@@

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
@@FUNCS@@

/* ---------------- 四、开局库（由生成器从既有模块取出；outputs/engine/opening-book.json 为可读副本） ---------------- */
/* 覆盖 0~8 子（前 9 手）：key = 轮到方(B/W) + '|' + 8 对称规范化后的棋子相对坐标串；
 * 应答为 [相对行, 相对列, 权重 5~1]，相对坐标以天元为中心。完整说明见 gomoku.html 原注释。 */
@@OPENING_BOOK@@

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
