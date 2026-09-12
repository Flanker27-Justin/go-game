// 探针：验证当前引擎对“跳型（间断）棋型”的识别能力与候选生成质量。
// 只读取 outputs/gomoku.html 里的函数，不修改任何文件。
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
  'let ttMap=null;let ttZobrist=null;let boardHash=0;let historyTable=null;let killerTable=null;\n' + body + ';\nreturn {lineInfo,directionScore,evaluateCell,threatLevel,countThreats,comboBonus,getBestMove,getCandidateMoves,evaluateBoard,findImmediateWin,canWinNow,findVcfWin,findDoubleKill,resolveThreats,scoreFor};');

const S = 19;
const EMPTY = 0, BLACK = 1, WHITE = 2, AI_COLOR = WHITE;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const LIVE_THREE_SCORE = 10000;
const HINT_RADIUS = 2;
const WIN_SCORE = 100000000;
const SEARCH_DEPTH = 3, CANDIDATE_LIMIT = 16, ROOT_CANDIDATE_LIMIT = 18, SEARCH_BUDGET_MS = 2500;
const MEDIUM_SEARCH_DEPTH = 3, MEDIUM_SEARCH_BUDGET_MS = 400;
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
let playerColor = BLACK;
let aiColor = WHITE;
let moveVariety = 0;
let searchState = null;
let lastVcfPath = null, lastVctPath = null;
const performance = { now: () => Date.now() };

const board = Array.from({ length: S }, () => Array(S).fill(EMPTY));
function reset() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = EMPTY; }
function put(color, cells) { for (const [r, c] of cells) board[r][c] = color; }
function at(r, c) { return r + ',' + c; }

const A = api(S, board, EMPTY, BLACK, WHITE, AI_COLOR, DIRECTIONS, LIVE_THREE_SCORE,
  HINT_RADIUS, WIN_SCORE, SEARCH_DEPTH, CANDIDATE_LIMIT, ROOT_CANDIDATE_LIMIT, SEARCH_BUDGET_MS, MEDIUM_SEARCH_DEPTH, MEDIUM_SEARCH_BUDGET_MS,
  VCF_MAX_PLIES, VCF_NODE_LIMIT, VCF_TIME_BUDGET_MS, VCT_MAX_PLIES, VCT_NODE_LIMIT, VCT_TIME_BUDGET_MS,
  OPENING_TOTAL_MOVES, OPENING_DOUBLE_BONUS, CONNECT_BONUS, CENTER_WEIGHT, DOUBLE_THREAT_BONUS, TEMPO_BONUS,
  LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD, playerColor, aiColor, moveVariety, searchState, lastVcfPath, lastVctPath, performance,
  TT_MAX_ENTRIES, TT_EXACT, TT_LOWER, TT_UPPER, TT_SIDE_ME, TT_SIDE_OPP, TT_PERSP_BLACK, TT_PERSP_WHITE, OPENING_BOOK, OPENING_BOOK_MAX_STONES, PATTERN_TABLE);

function info(line) { console.log(line); }

function fresh(blackCells, whiteCells) {
  reset();
  put(BLACK, blackCells || []);
  put(WHITE, whiteCells || []);
}
function showMove(label, level, forColor) {
  const t0 = Date.now();
  const mv = A.getBestMove(level, forColor);
  return label + '=' + (mv ? mv.join(',') : 'null') + '(' + (Date.now() - t0) + 'ms)';
}

console.log('===== A. 跳型（间断）棋型识别 =====');
// A1 跳三 X_XX（黑 10,5 / 10,7 / 10,8；缺口 10,6 补上成四）
fresh([[10,5],[10,7],[10,8]]);
info('跳三 X_XX：落在缺口 (10,6) 后 → lineInfo=' + JSON.stringify(A.lineInfo(10,6,0,1,BLACK)) +
     ' threatLevel=' + A.threatLevel(10,6,BLACK));
info('  该手 lineScore 视角分数 evaluateCell(10,6)=' + A.evaluateCell(10,6,BLACK));
// 对照：正连三落在端点
fresh([[10,5],[10,6],[10,7]]);
info('对照 连三 XXX 落在端点 (10,8) → threatLevel=' + A.threatLevel(10,8,BLACK) +
     ' evaluateCell=' + A.evaluateCell(10,8,BLACK));

// A2 跳四 X_XXX → 缺口成五
fresh([[10,5],[10,7],[10,8],[10,9]]);
info('跳四 X_XXX：canWinNow(10,6)=' + A.canWinNow(10,6,BLACK) + ' findImmediateWin 命中=' + !!A.findImmediateWin(BLACK));

// A3 跳四 XX_XX → 缺口成五
fresh([[10,4],[10,5],[10,7],[10,8]]);
info('跳四 XX_XX：canWinNow(10,6)=' + A.canWinNow(10,6,BLACK) + ' findImmediateWin 命中=' + !!A.findImmediateWin(BLACK));

// A4 “跳活三” X_XX 两端都开：是否被认成必须应对的威胁
fresh([[10,4],[10,6],[10,7]]);
info('跳活三 _X_XX_：威胁点 (10,5) 的 threatLevel=' + A.threatLevel(10,5,BLACK) +
     ' countThreats=' + A.countThreats(10,5,BLACK));

console.log('');
console.log('===== B. 候选点生成：跳型要点是否进入候选/排序 =====');
fresh([[9,9],[9,11],[9,12]]);   // 黑跳三 X_XX，要点 (9,10)
const cand = A.getCandidateMoves(16, BLACK);
info('getCandidateMoves(BLACK,16) 前 10: ' + cand.slice(0,10).map(m => m.join(',')).join(' | '));
info('  跳三要点 (9,10) 在候选内? ' + cand.some(m => m[0] === 9 && m[1] === 10) +
     ' ; 其排名 = ' + (cand.findIndex(m => m[0] === 9 && m[1] === 10) + 1 || '未进入'));
info('  延伸点 (9,8)/(9,13) 在候选内? ' + cand.some(m => m[0] === 9 && (m[1] === 8 || m[1] === 13)));

console.log('');
console.log('===== C. 单跳三防守：AI 是否认得“跳三” =.= ');
// 黑(玩家)有跳活三 _X_XX_（(10,4)(10,6)(10,7)）：要点是 (10,5) 与 (10,8)
fresh([[10,4],[10,6],[10,7]], [[9,9],[11,11]]);
info(showMove('medium', LEVEL_MEDIUM));
info(showMove('hard', LEVEL_HARD));
info('  黑跳活三的关键点是 (10,5) 与 (10,8)；若 AI 走在别处，下一手黑在 (10,5) 即成“活四”级别');

console.log('');
console.log('===== D. 双跳三（两个方向都是跳型活三）=====');
fresh([[10,4],[10,6],[10,7],[7,10],[9,10],[10,10]], [[9,9],[11,11]]);
info('黑双向跳三 (_X_XX_ 横 + 竖)，轮白：');
info(showMove('medium', LEVEL_MEDIUM));
info(showMove('hard', LEVEL_HARD));
info('  黑两个要点 (10,5) / (8,10)：白只能堵一个 → 理论必败');

console.log('');
console.log('===== E. 评估函数对“跳型”的敏感度 =====');
fresh([[10,5],[10,6],[10,7]]);
const ev1 = A.evaluateBoard(WHITE, BLACK, 1, null);
fresh([[10,5],[10,6],[10,8]]);
const ev2 = A.evaluateBoard(WHITE, BLACK, 1, null);
info('白正连活三 XXX  → evaluateBoard=' + ev1);
info('白跳活三 X_XX   → evaluateBoard=' + ev2 + '   （偏低说明评估忽略间断棋型）');
fresh([[10,5],[10,7]]);
info('白两个跳二 X_X  → evaluateBoard=' + A.evaluateBoard(WHITE, BLACK, 1, null));

console.log('');
console.log('===== F. 四三 / 双四组合的识别 =====');
// 黑同时有冲四和跳三：白是否能找到唯一解
fresh([[10,5],[10,6],[10,7],[10,8],[9,9],[9,10],[9,12]], [[11,11]]);
info('黑有冲四(横) + 跳三(纵)，轮白（这是四三杀，理论必败）:');
info(showMove('hard', LEVEL_HARD));
