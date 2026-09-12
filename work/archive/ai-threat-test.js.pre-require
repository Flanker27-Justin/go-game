// 五子棋 AI 威胁分层 + VCF + 双杀 + 残局评估回归测试：直接从 gomoku.html 提取函数运行。
'use strict';
const fs = require('fs');
const src = fs.readFileSync('outputs/gomoku.html', 'utf8');

function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数 ' + name);
  const brace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0, i = brace;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const fns = ['inBoard', 'lineInfo', 'lineScore', 'directionScore', 'evaluateCell',
             'threatLevel', 'scoreFor', 'resolveThreats', 'canWinNow', 'findImmediateWin',
             'getCandidateMoves', 'evaluateBoard', 'comboBonus', 'countThreats', 'threatSpaceBonus',
             'minimax', 'bestBySearch', 'bestByScore', 'getBestMove', 'searchDepth', 'forcingMovesOf',
             'findVcfWin', 'vcfSearch', 'vcfForcingMoves', 'vcfBlockPoints',
             'findVctWin', 'vctSearch', 'vctForcingMoves', 'vctBlockPoints', 'vctDefense',
              'findDoubleThreat', 'findOpponentDoubleThreat', 'openingMove',
             'pickVaried', 'pickTopN', 'initSearchTables', 'hashXor', 'ttStore', 'findDoubleKill', 'bookMove'];
const body = fns.map(extractFn).join('\n');
const api = new Function(
  'boardSize', 'board', 'EMPTY', 'BLACK', 'WHITE', 'AI_COLOR', 'DIRECTIONS', 'LIVE_THREE_SCORE',
  'HINT_RADIUS', 'WIN_SCORE', 'SEARCH_DEPTH', 'CANDIDATE_LIMIT', 'ROOT_CANDIDATE_LIMIT', 'SEARCH_BUDGET_MS', 'MEDIUM_SEARCH_DEPTH', 'MEDIUM_SEARCH_BUDGET_MS',
  'VCF_MAX_PLIES', 'VCF_NODE_LIMIT', 'VCF_TIME_BUDGET_MS', 'VCT_MAX_PLIES', 'VCT_NODE_LIMIT', 'VCT_TIME_BUDGET_MS',
  'OPENING_TOTAL_MOVES', 'OPENING_DOUBLE_BONUS', 'CONNECT_BONUS', 'CENTER_WEIGHT', 'DOUBLE_THREAT_BONUS', 'TEMPO_BONUS',
  'LEVEL_EASY', 'LEVEL_MEDIUM', 'LEVEL_HARD', 'playerColor', 'aiColor', 'moveVariety', 'searchState', 'lastVcfPath', 'lastVctPath', 'performance',
  'TT_MAX_ENTRIES', 'TT_EXACT', 'TT_LOWER', 'TT_UPPER', 'TT_SIDE_ME', 'TT_SIDE_OPP', 'TT_PERSP_BLACK', 'TT_PERSP_WHITE', 'OPENING_BOOK', 'OPENING_BOOK_MAX_STONES', 'PATTERN_TABLE',
  'let ttMap=null;let ttZobrist=null;let boardHash=0;let historyTable=null;let killerTable=null;\n' + body + ';\nreturn {threatLevel,resolveThreats,getBestMove,evaluateBoard,getCandidateMoves,' +
  'findVcfWin,findVctWin,findDoubleThreat,findDoubleKill,findOpponentDoubleThreat,openingMove,comboBonus,countThreats,searchDepth,pickVaried,pickTopN,forcingMovesOf,bestBySearch,getLastVctPath:()=>lastVctPath};');

const S = 19;
const EMPTY = 0, BLACK = 1, WHITE = 2, AI_COLOR = WHITE;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const LIVE_THREE_SCORE = 10000;
const HINT_RADIUS = 2;
const WIN_SCORE = 100000000;
const SEARCH_DEPTH = 3, CANDIDATE_LIMIT = 16, ROOT_CANDIDATE_LIMIT = 18, SEARCH_BUDGET_MS = 2500;
const MEDIUM_SEARCH_DEPTH = 3, MEDIUM_SEARCH_BUDGET_MS = 600;
const VCF_MAX_PLIES = 10, VCF_NODE_LIMIT = 5000, VCF_TIME_BUDGET_MS = 250;
const VCT_MAX_PLIES = 10, VCT_NODE_LIMIT = 5000, VCT_TIME_BUDGET_MS = 300;
const OPENING_TOTAL_MOVES = 8, OPENING_DOUBLE_BONUS = 20000;
const CONNECT_BONUS = 30, CENTER_WEIGHT = 25, DOUBLE_THREAT_BONUS = 30000, TEMPO_BONUS = 1500;
const TT_MAX_ENTRIES = 300000, TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2, TT_SIDE_ME = 0x9E3779B9, TT_SIDE_OPP = 0x85EBCA77;
const TT_PERSP_BLACK = 0x6D2B79F5, TT_PERSP_WHITE = 0x1B56C4E9;
const OPENING_BOOK = JSON.parse(fs.readFileSync('work/opening-book.json', 'utf8'));
const OPENING_BOOK_MAX_STONES = 8;
const PATTERN_TABLE = [[0,0,0],[10,10,100],[100,100,1000],[1000,1000,10000],[10000,10000,100000],[1000000,1000000,1000000]];
const LEVEL_EASY = 'easy', LEVEL_MEDIUM = 'medium', LEVEL_HARD = 'hard';
let playerColor = BLACK;   // 与页面一致：默认玩家执黑
let aiColor = WHITE;       // 与页面一致：默认 AI 执白
let moveVariety = 0;       // 测试固定为 0：关闭随机，保证断言确定
let searchState = null;
let lastVcfPath = null;
let lastVctPath = null;
const performance = { now: () => Date.now() };

const board = Array.from({ length: S }, () => Array(S).fill(EMPTY));
function reset() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = EMPTY; }
function put(color, cells) { for (const [r, c] of cells) board[r][c] = color; }
const inB = (r, c) => r >= 0 && r < S && c >= 0 && c < S;

const A = api(S, board, EMPTY, BLACK, WHITE, AI_COLOR, DIRECTIONS, LIVE_THREE_SCORE,
              HINT_RADIUS, WIN_SCORE, SEARCH_DEPTH, CANDIDATE_LIMIT, ROOT_CANDIDATE_LIMIT, SEARCH_BUDGET_MS, MEDIUM_SEARCH_DEPTH, MEDIUM_SEARCH_BUDGET_MS,
              VCF_MAX_PLIES, VCF_NODE_LIMIT, VCF_TIME_BUDGET_MS, VCT_MAX_PLIES, VCT_NODE_LIMIT, VCT_TIME_BUDGET_MS,
              OPENING_TOTAL_MOVES, OPENING_DOUBLE_BONUS, CONNECT_BONUS, CENTER_WEIGHT, DOUBLE_THREAT_BONUS, TEMPO_BONUS,
              LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD, playerColor, aiColor, moveVariety, searchState, lastVcfPath, lastVctPath, performance,
              TT_MAX_ENTRIES, TT_EXACT, TT_LOWER, TT_UPPER, TT_SIDE_ME, TT_SIDE_OPP, TT_PERSP_BLACK, TT_PERSP_WHITE, OPENING_BOOK, OPENING_BOOK_MAX_STONES, PATTERN_TABLE);

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + ' 期望 ' + JSON.stringify(expected) + ' 实际 ' + JSON.stringify(actual)); }
}
function checkAny(label, actual, options) {
  const ok = options.some(o => JSON.stringify(o) === JSON.stringify(actual));
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + ' 允许 ' + JSON.stringify(options) + ' 实际 ' + JSON.stringify(actual)); }
}
function checkTrue(label, cond) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

console.log('== 场景1：对方直活三（三个子）必须挡 ==');
reset();
put(BLACK, [[10, 5], [10, 6], [10, 7]]);     // 黑: _ X X X _
put(WHITE, [[2, 2]]);
checkAny('getBestMove(medium) 挡活三端点', A.getBestMove(LEVEL_MEDIUM), [[10, 4], [10, 8]]);

console.log('== 场景2：对方跳三（成活四）必须挡 ==');
reset();
put(BLACK, [[10, 5], [10, 6], [10, 8]]);     // 黑: X X _ X，补 (10,7) 成活四
put(WHITE, [[2, 2]]);
check('getBestMove(medium) 挡活四点', A.getBestMove(LEVEL_MEDIUM), [10, 7]);

console.log('== 场景3：自己跳三能成活四 → 主动制胜 ==');
reset();
put(WHITE, [[10, 5], [10, 6], [10, 8]]);     // 白: X X _ X
put(BLACK, [[2, 2]]);
check('getBestMove(medium) 成活四', A.getBestMove(LEVEL_MEDIUM), [10, 7]);

console.log('== 场景4：无防守压力时自己活三进攻 ==');
reset();
put(WHITE, [[10, 6], [10, 7]]);              // 白: X X，下 (10,8) 成活三
put(BLACK, [[2, 2]]);
check('getBestMove(medium) 成活三', A.getBestMove(LEVEL_MEDIUM), [10, 8]);

console.log('== 场景5：残局评估每行只计一次分（含连接性/中心权重） ==');
reset();
put(WHITE, [[10, 6], [10, 7], [10, 8]]);     // 一条活三
const ev = A.evaluateBoard();
check('evaluateBoard(一条活三) = 42160（棋型/连接/中心 12160 + 威胁空间 30000）', ev, 42160);
// 新增威胁空间项：活三两端 (10,5)/(10,9) 各是一个“活四形成点”，每个 +15000
// （棋型表分 10900 + 连接性 60 + 中心权重 1200 = 12160；威胁空间 30000）

console.log('== 场景6：候选点强制走法优先 ==');
reset();
put(BLACK, [[10, 5], [10, 6], [10, 8]]);
const cands = A.getCandidateMoves(10, AI_COLOR);
checkTrue('挡活四点出现在前 5 个候选', cands.slice(0, 5).some(([r, c]) => r === 10 && c === 7));

console.log('== 场景7：困难档端到端（19 路）冒烟（开局阶段） ==');
reset();
put(BLACK, [[9, 9], [10, 9], [12, 9]]);
put(WHITE, [[9, 8], [10, 10], [11, 9], [8, 9]]);
let t0 = Date.now();
let hardMove = A.getBestMove(LEVEL_HARD);
let dt = Date.now() - t0;
checkTrue('hard 返回合法落点', hardMove && inB(hardMove[0], hardMove[1]) && board[hardMove[0]][hardMove[1]] === EMPTY);
check('hard 响应 < 2000ms', dt < 2000, true);
console.log('    耗时: ' + dt + 'ms  落点: ' + JSON.stringify(hardMove));

console.log('== 场景8：困难档中盘搜索冒烟（已过开局阶段，走完整搜索） ==');
reset();
// 填满 12 子，让 placed >= 8 跳过开局策略，强制走 Alpha-Beta 搜索
put(BLACK, [[3, 3], [4, 3], [5, 3], [6, 3], [8, 8], [8, 9]]);
put(WHITE, [[3, 4], [4, 4], [5, 4], [8, 7], [9, 8], [10, 8]]);
t0 = Date.now();
hardMove = A.getBestMove(LEVEL_HARD);
dt = Date.now() - t0;
checkTrue('hard 中盘返回合法落点', hardMove && inB(hardMove[0], hardMove[1]) && board[hardMove[0]][hardMove[1]] === EMPTY);
check('hard 中盘响应 < 3000ms', dt < 3000, true);
console.log('    耗时: ' + dt + 'ms  落点: ' + JSON.stringify(hardMove));

console.log('== 场景9：防守反击选点——挡棋优先选“挡住又能反击”的位置 ==');
reset();
put(BLACK, [[10, 6], [10, 7], [10, 8]]);     // 黑: _ X X X _ 活三
put(WHITE, [[8, 5], [9, 5]]);                // 白竖线，下 (10,5) 可同时成活三
check('getBestMove(medium) 挡在可反击点 (10,5)', A.getBestMove(LEVEL_MEDIUM), [10, 5]);

console.log('== 场景10：动态搜索深度随残局加深 ==');
reset();
check('空盘 searchDepth = 3', A.searchDepth(), 3);
for (let i = 0; i < 40; i++) put(i % 2 === 0 ? WHITE : BLACK, [[i % 19, Math.floor(i / 19)]]);
check('40 子 searchDepth = 5', A.searchDepth(), 5);
for (let i = 40; i < 100; i++) put(i % 2 === 0 ? WHITE : BLACK, [[i % 19, Math.floor(i / 19)]]);
check('100 子 searchDepth = 6', A.searchDepth(), 6);

console.log('== 场景11：VCF 连续冲四杀棋——2 层强制胜 ==');
reset();
// 白：横向 (10,3)-(10,5) 被黑 (10,2) 封左端 → 下 (10,6) 成冲四，黑被迫挡 (10,7)；
// 白对角 (8,4),(9,5) 与 (10,6) 连成活四 → 强制胜。补足 8 子跳过开局策略。
put(BLACK, [[10, 2], [2, 2], [2, 3]]);
put(WHITE, [[10, 3], [10, 4], [10, 5], [8, 4], [9, 5]]);
check('findVcfWin(WHITE) 返回首个强制冲四点 (10,6)', A.findVcfWin(WHITE, VCF_MAX_PLIES), [10, 6]);
check('getBestMove(medium) 走 VCF 强制点', A.getBestMove(LEVEL_MEDIUM), [10, 6]);
reset();
put(BLACK, [[10, 2], [2, 2], [2, 3]]);
put(WHITE, [[10, 3], [10, 4], [10, 5], [8, 4], [9, 5]]);
check('getBestMove(hard) 也走 VCF 强制点', A.getBestMove(LEVEL_HARD), [10, 6]);

console.log('== 场景12：对方 VCF——AI 必须堵起手冲四端点 ==');
reset();
// 镜像：黑有同样的 VCF 结构，白必须先占 (10,6) 拆掉黑棋杀棋。
put(WHITE, [[10, 2], [2, 2], [2, 3]]);
put(BLACK, [[10, 3], [10, 4], [10, 5], [8, 4], [9, 5]]);
check('getBestMove(medium) 堵黑方 VCF 起点', A.getBestMove(LEVEL_MEDIUM), [10, 6]);

console.log('== 场景13：双四不可防 → 强制选中 ==');
reset();
put(BLACK, [[10, 2], [11, 6], [5, 6], [2, 2]]);
put(WHITE, [[10, 3], [10, 4], [10, 5], [7, 6], [8, 6], [9, 6]]);
check('getBestMove(medium) 下双四点 (10,6)', A.getBestMove(LEVEL_MEDIUM), [10, 6]);

console.log('== 场景14：双三不是强制胜，但组合分显著加分 ==');
reset();
put(BLACK, [[2, 2], [0, 0], [0, 2], [2, 0], [4, 6]]);
put(WHITE, [[10, 3], [10, 4], [8, 5], [9, 5]]);
check('countThreats(10,5,WHITE) = 2（双三）', A.countThreats(10, 5, WHITE), 2);
check('findDoubleThreat(WHITE) = null（双三不强制）', A.findDoubleThreat(WHITE), null);
check('comboBonus(WHITE) = 30000（双三组合分）', A.comboBonus(WHITE), 30000);
check('getBestMove(medium) 主动下双三 (10,5)', A.getBestMove(LEVEL_MEDIUM), [10, 5]);

console.log('== 场景15：开局库——黑占天元，白应天元旁 ==');
reset();
put(BLACK, [[9, 9]]);
const open1 = A.getBestMove(LEVEL_MEDIUM);
check('开局库命中：黑天元 → 白应 (8,9)（库内权重最高应答）', open1, [8, 9]);
reset();
put(BLACK, [[9, 9], [9, 8], [11, 9]]);   // 5 子局面同样命中开局库（bestSym=5）
put(WHITE, [[9, 7], [10, 8]]);
check('开局库命中 5 子局面：白应 (10,9)（堵黑跳三缺口）', A.getBestMove(LEVEL_MEDIUM), [10, 9]);

console.log('== 场景15C：开局库空盘与对称性 ==');
reset();
check('空盘 AI 执黑视角首手按库落天元 (9,9)', A.getBestMove(LEVEL_MEDIUM, BLACK), [9, 9]);
// 同一局面整体旋转 90°：8 对称规范化命中同一 key，应答同步旋转
reset();
put(BLACK, [[9, 9], [10, 9], [9, 11]]);   // 基准局面的旋转 90° 版本
put(WHITE, [[11, 9], [10, 10]]);
check('旋转 90° 后白应同步旋转为 (9,10)', A.getBestMove(LEVEL_MEDIUM), [9, 10]);

console.log('== 场景16A：对方眠三（三连一端已死）不强制堵，交给搜索/评分权衡 ==');
reset();
// 黑: X X X，左端 (10,5) 被白堵 → 眠三，开放端 (10,9)（黑落此成冲四，威胁等级 2）
// 这种棋型不是杀棋：黑即使冲四也会被一步步挡死，不应机械地占 (10,9)。
// AI 应把这一步让给搜索/评分权衡，优先做有进攻价值的棋（如成活三）。
put(BLACK, [[10, 6], [10, 7], [10, 8]]);
put(WHITE, [[10, 5], [8, 3], [9, 3]]);   // 白竖线，下 (10,3) 可成活三
checkTrue('getBestMove(medium) 不再机械堵眠三开放端 (10,9)',
      (function () { const m = A.getBestMove(LEVEL_MEDIUM); return m && !(m[0] === 10 && m[1] === 9); })());

console.log('== 场景16：对方双杀威胁（一手成双三）→ 抢先堵关键点 ==');
reset();
// 黑方两路活二汇于 (9,9)：黑在 (9,9) 一手可成横竖两个活三（双三）
put(BLACK, [[9, 7], [9, 8], [7, 9], [8, 9]]);
check('findOpponentDoubleThreat(BLACK) 找到双杀点 (9,9)',
      A.findOpponentDoubleThreat(BLACK), [9, 9]);
check('getBestMove(medium) 抢先占住 (9,9) 化解双杀',
      A.getBestMove(LEVEL_MEDIUM), [9, 9]);

console.log('== 场景17：开局随机化——同一开局不再永远同一手 ==');
reset();
put(BLACK, [[9, 9]]);
// 用 moveVariety=1 的独立 api 实例验证随机出棋（共享同一棋盘对象）
const A2 = api(S, board, EMPTY, BLACK, WHITE, AI_COLOR, DIRECTIONS, LIVE_THREE_SCORE,
               HINT_RADIUS, WIN_SCORE, SEARCH_DEPTH, CANDIDATE_LIMIT, ROOT_CANDIDATE_LIMIT, SEARCH_BUDGET_MS, MEDIUM_SEARCH_DEPTH, MEDIUM_SEARCH_BUDGET_MS,
               VCF_MAX_PLIES, VCF_NODE_LIMIT, VCF_TIME_BUDGET_MS, VCT_MAX_PLIES, VCT_NODE_LIMIT, VCT_TIME_BUDGET_MS,
               OPENING_TOTAL_MOVES, OPENING_DOUBLE_BONUS, CONNECT_BONUS, CENTER_WEIGHT, DOUBLE_THREAT_BONUS, TEMPO_BONUS,
               LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD, playerColor, aiColor, 1, searchState, lastVcfPath, lastVctPath, performance,
               TT_MAX_ENTRIES, TT_EXACT, TT_LOWER, TT_UPPER, TT_SIDE_ME, TT_SIDE_OPP, TT_PERSP_BLACK, TT_PERSP_WHITE, OPENING_BOOK, OPENING_BOOK_MAX_STONES, PATTERN_TABLE);
const distinct = new Set();
let allNearCenter = true;
for (let i = 0; i < 30; i++) {
  reset();
  put(BLACK, [[9, 9]]);
  const m = A2.getBestMove(LEVEL_MEDIUM);
  if (!m) { allNearCenter = false; break; }
  distinct.add(m[0] + ',' + m[1]);
  if (Math.abs(m[0] - 9) + Math.abs(m[1] - 9) > 2) allNearCenter = false;  // 开局库应答都在天元 2 格内
}
checkTrue('30 次开局出现 ≥2 种不同走法（变幻莫测）', distinct.size >= 2);
checkTrue('随机出的每手都在天元 2 格内（开局库应答）', allNearCenter);
checkTrue('moveVariety=0 时仍完全确定（A 实例）',
          JSON.stringify(A.getBestMove(LEVEL_MEDIUM)) === JSON.stringify(A.getBestMove(LEVEL_MEDIUM)));

console.log('== 场景18：双方各有活三，轮白 → 白活三→活四制胜（先手权优先于防守） ==');
reset();
put(WHITE, [[10, 5], [10, 6], [10, 7]]);     // 白活三
put(BLACK, [[12, 5], [12, 6], [12, 7]]);     // 黑活三（后手）
put(BLACK, [[2, 2]]);
checkAny('getBestMove(medium) 白活三变活四', A.getBestMove(LEVEL_MEDIUM), [[10, 4], [10, 8]]);
reset();
put(WHITE, [[10, 5], [10, 6], [10, 7]]);
put(BLACK, [[12, 5], [12, 6], [12, 7]]);
put(BLACK, [[2, 2]]);
checkAny('getBestMove(hard) 白活三变活四', A.getBestMove(LEVEL_HARD), [[10, 4], [10, 8]]);

console.log('== 场景19：forcingMovesOf 强制点收集 ==');
reset();
put(BLACK, [[10, 5], [10, 6], [10, 7]]);     // 黑活三 → 端点 (10,4)/(10,8) 是黑活四形成点
put(WHITE, [[2, 2]]);
const fm = A.forcingMovesOf(BLACK, 3);
checkTrue('forcingMovesOf(BLACK,3) 含活三两个端点',
      fm.some(([r, c]) => r === 10 && c === 4) && fm.some(([r, c]) => r === 10 && c === 8));
checkTrue('forcingMovesOf(BLACK,3) 不含普通空位', fm.length === 2);

console.log('== 场景20：简单档补最基本的成五/挡五拦截 ==');
reset();
put(BLACK, [[10, 5], [10, 6], [10, 7], [10, 8]]);   // 黑冲四，下一手 (10,9) 成五
put(WHITE, [[10, 4], [2, 2]]);                       // (10,4) 封左端 → 唯一成五点 (10,9)
check('getBestMove(easy) 挡住黑成五点', A.getBestMove(LEVEL_EASY), [10, 9]);
reset();
put(WHITE, [[10, 5], [10, 6], [10, 7], [10, 8]]);   // 白冲四
put(BLACK, [[10, 4], [2, 2]]);                       // (10,4) 封左端 → 白唯一成五点 (10,9)
check('getBestMove(easy) 自己能成五先赢', A.getBestMove(LEVEL_EASY), [10, 9]);

console.log('== 场景21：先手权（tempo）评估 ==');
reset();
put(WHITE, [[10, 5], [10, 6], [10, 7]]);
put(BLACK, [[12, 5], [12, 6], [12, 7]]);
const evWhiteTurn = A.evaluateBoard(WHITE, BLACK, 1, WHITE);
const evBlackTurn = A.evaluateBoard(WHITE, BLACK, 1, BLACK);
checkTrue('轮到白（先手方）的评估分更高', evWhiteTurn > evBlackTurn);
check('先手分差 = 2×TEMPO_BONUS = 3000', evWhiteTurn - evBlackTurn, 3000);

console.log('== 场景22：VCF 返回最短杀棋路径起点 ==');
reset();
put(BLACK, [[10, 2], [2, 2], [2, 3]]);
put(WHITE, [[10, 3], [10, 4], [10, 5], [8, 4], [9, 5]]);
const vcfMove = A.getBestMove(LEVEL_MEDIUM);
check('VCF 起点仍为 (10,6)', vcfMove, [10, 6]);

console.log('== 场景23：置换表确定性 + 35/60 子分层 + 中盘/残局冒烟 ==');
reset();
check('空盘 searchDepth = 3', A.searchDepth(), 3);
for (let i = 0; i < 35; i++) put(i % 2 === 0 ? WHITE : BLACK, [[i % 19, Math.floor(i / 19)]]);
check('35 子 searchDepth = 5', A.searchDepth(), 5);
for (let i = 35; i < 60; i++) put(i % 2 === 0 ? WHITE : BLACK, [[i % 19, Math.floor(i / 19)]]);
check('60 子 searchDepth = 6', A.searchDepth(), 6);

// 中盘“安静局面”（36 子、无即时杀棋）：hard 走完整搜索，验证置换表不引入不确定性
reset();
put(BLACK, [[3, 3], [3, 4], [4, 3], [4, 4], [8, 8], [8, 9], [9, 8], [9, 9],
             [13, 13], [13, 14], [14, 13], [14, 14], [6, 12], [7, 12], [6, 13], [7, 13],
             [12, 5], [12, 6], [13, 5], [13, 6]]);
put(WHITE, [[5, 5], [5, 6], [6, 5], [6, 6], [10, 10], [10, 11], [11, 10], [11, 11],
             [2, 15], [2, 16], [3, 15], [3, 16], [15, 2], [15, 3], [16, 2], [16, 3]]);
t0 = Date.now();
const h1 = A.getBestMove(LEVEL_HARD);
const dt1 = Date.now() - t0;
const h2 = A.getBestMove(LEVEL_HARD);
checkTrue('hard 同局面两次结果一致（置换表确定性）', JSON.stringify(h1) === JSON.stringify(h2));
checkTrue('中盘 hard 落点合法', h1 && inB(h1[0], h1[1]) && board[h1[0]][h1[1]] === EMPTY);
check('中盘 hard 响应 < 4500ms', dt1 < 4500, true);
console.log('    中盘耗时: ' + dt1 + 'ms  落点: ' + JSON.stringify(h1));

// 残局（70 子，placed >= 60 → 6 层）hard 冒烟：预算内返回且落点合法
reset();
for (let i = 0; i < 70; i++) put(i % 2 === 0 ? WHITE : BLACK, [[i % 19, Math.floor(i / 19)]]);
t0 = Date.now();
const hEnd = A.getBestMove(LEVEL_HARD);
dt = Date.now() - t0;
checkTrue('残局 hard 返回合法落点', hEnd && inB(hEnd[0], hEnd[1]) && board[hEnd[0]][hEnd[1]] === EMPTY);
check('残局 hard 响应 < 4500ms', dt < 4500, true);
console.log('    残局耗时: ' + dt + 'ms  落点: ' + JSON.stringify(hEnd));

console.log('== 场景24：直接调用 bestBySearch（TT+历史启发+迭代加深真实路径） ==');
reset();
put(BLACK, [[3, 3], [3, 4], [4, 3], [4, 4], [8, 8], [8, 9], [9, 8], [9, 9],
             [13, 13], [13, 14], [14, 13], [14, 14], [6, 12], [7, 12], [6, 13], [7, 13],
             [12, 5], [12, 6], [13, 5], [13, 6]]);
put(WHITE, [[5, 5], [5, 6], [6, 5], [6, 6], [10, 10], [10, 11], [11, 10], [11, 11],
             [2, 15], [2, 16], [3, 15], [3, 16], [15, 2], [15, 3], [16, 2], [16, 3]]);
t0 = Date.now();
const bs1 = A.bestBySearch(WHITE, BLACK, LEVEL_HARD);
const dbs1 = Date.now() - t0;
const bs2 = A.bestBySearch(WHITE, BLACK, LEVEL_HARD);
checkTrue('bestBySearch 返回合法落点', bs1 && inB(bs1[0], bs1[1]) && board[bs1[0]][bs1[1]] === EMPTY);
checkTrue('bestBySearch 两次结果一致', JSON.stringify(bs1) === JSON.stringify(bs2));
check('bestBySearch 响应 < 4500ms', dbs1 < 4500, true);
console.log('    耗时: ' + dbs1 + 'ms  落点: ' + JSON.stringify(bs1));

console.log('== 场景25：双三“阵法杀招”——安静局面优先建立必胜阵型 ==');
reset();
put(BLACK, [[2, 2], [2, 3]]);                    // 对方无任何威胁
put(WHITE, [[10, 3], [10, 4], [8, 5], [9, 5]]);  // (10,5) 一手成横竖双活三
check('findDoubleKill(WHITE) = 双三点 (10,5)', A.findDoubleKill(WHITE), [10, 5]);
check('getBestMove(medium) 主动下双三', A.getBestMove(LEVEL_MEDIUM), [10, 5]);
reset();
put(BLACK, [[2, 2], [2, 3]]);
put(WHITE, [[10, 3], [10, 4], [8, 5], [9, 5]]);
check('getBestMove(hard) 也主动下双三', A.getBestMove(LEVEL_HARD), [10, 5]);

console.log('== 场景26：对方有活三时双杀不成立 → 先防守 ==');
reset();
// 白有双三点 (10,5)，但黑有活三 (12,5)(12,6)(12,7) → 黑两子内可成五，必须先堵
put(BLACK, [[12, 5], [12, 6], [12, 7], [2, 2]]);
put(WHITE, [[10, 3], [10, 4], [8, 5], [9, 5]]);
check('findDoubleKill(WHITE) = null（对方威胁更快）', A.findDoubleKill(WHITE), null);
checkAny('getBestMove(medium) 先堵对方活三端点', A.getBestMove(LEVEL_MEDIUM), [[12, 4], [12, 8]]);


console.log('== 场景27：VCT 双三链杀——一手双三，对方堵哪路都输 ==');
reset();
// 黑：(9,8)(9,10) 横路活二 + (8,9)(10,9) 竖路活二，落 (9,9) 成横竖双活三（双三）
// 对方无论堵哪个端点，另一路都能延伸成活四 → 2 手强制胜
put(BLACK, [[9, 8], [9, 10], [8, 9], [10, 9]]);
put(WHITE, [[2, 2], [2, 3], [17, 17]]);
check('findVctWin(BLACK) 找到双三链杀起点 (9,9)', A.findVctWin(BLACK), [9, 9]);
checkTrue('lastVctPath 记录杀棋路径且首手一致',
  Array.isArray(A.getLastVctPath()) && A.getLastVctPath().length >= 2 && JSON.stringify(A.getLastVctPath()[0]) === JSON.stringify([9, 9]));
reset();
put(BLACK, [[9, 8], [9, 10], [8, 9], [10, 9]]);
put(WHITE, [[2, 2], [2, 3], [17, 17]]);
check('getBestMove(hard) 也走出双三杀招', A.getBestMove(LEVEL_HARD), [9, 9]);

console.log('== 场景28：VCT 负例——只有单活三不算强制胜（AND 节点拒绝） ==');
reset();
// 黑只有一路活二 (9,9)(9,10)：落 (9,8) 成活三，对方堵任一端后只能冲四被挡，无必胜
put(BLACK, [[9, 9], [9, 10]]);
put(WHITE, [[2, 2], [2, 3], [17, 17]]);
check('findVctWin(BLACK) = null（无强制胜序列）', A.findVctWin(BLACK), null);

console.log('== 场景29：对方 VCT 跳四杀点 → AI 必须防守 ==');
reset();
// 白：(9,9)(9,10)(9,12) 跳四线，落 (9,11) 即成活四（不可防）
put(WHITE, [[9, 9], [9, 10], [9, 12]]);
put(BLACK, [[2, 2], [2, 3]]);
check('findVctWin(WHITE) 找到跳四杀点 (9,11)', A.findVctWin(WHITE), [9, 11]);
check('getBestMove(hard) 抢先占住 (9,11) 防守', A.getBestMove(LEVEL_HARD), [9, 11]);

console.log('== 结构检查：关键函数必须为顶层声明（防止被意外嵌套导致浏览器端 undefined） ==');
// 带注释/字符串跳过的括号扫描：统计指定函数声明之前的 { } 配平深度，
// 深度必须为 0（顶层）。曾出现过 openingMove 缺右括号把 bookMove 吞进函数体、
// 导致浏览器端 bookMove 未定义、AI 卡死，而“按函数提取”的测试却全部通过的问题。
function braceDepthBefore(name) {
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) return { depth: -1, line: -1 };
  let depth = 0, i = 0;
  while (i < idx) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { while (i < idx && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { i += 2; while (i < idx && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (ch === '"' || ch === "'") { const q = ch; i++; while (i < idx) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === q) break; i++; } i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return { depth, line: src.slice(0, idx).split('\n').length };
}
for (const n of ['openingMove', 'bookMove', 'getBestMove', 'minimax', 'bestBySearch', 'aiMove', 'findVcfWin', 'findVctWin']) {
  const d = braceDepthBefore(n);
  check('顶层声明: ' + n + ' (深度 ' + d.depth + ', 行 ' + d.line + ')', d.depth, 0);
}

console.log('\n结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);


