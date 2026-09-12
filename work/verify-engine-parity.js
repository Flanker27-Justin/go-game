// 等价性验证：当前引擎模块 outputs/engine/gomoku-ai.js 必须与**拆分前的冻结版本**
// （work/archive/gomoku.html.pre-engine-split 里的内联引擎）在大量随机局面上给出
// 完全一致的结果。任何不一致都说明后续改动引入了回归。
//
// 为什么用归档文件而不是 outputs/gomoku.html：拆分后页面里已经没有内联引擎了，
// 归档的 pre-split 版本是“重构前的黄金参照”，可长期作为行为基线使用。
//
// 用法: node work/verify-engine-parity.js [局面数] [随机种子]
//   局面数默认 30，种子默认 12345（确定性）
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const S = 19;
const EMPTY = 0, BLACK = 1, WHITE = 2;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

const AI = require(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'));

/* ---------- 参照引擎：从“拆分前冻结版本”里提取内联实现 ---------- */
const FROZEN = path.join(ROOT, 'work', 'archive', 'gomoku.html.pre-engine-split');
if (!fs.existsSync(FROZEN)) {
  console.log('缺少冻结参照文件: work/archive/gomoku.html.pre-engine-split');
  console.log('（该文件由引擎拆分时的备份产生，用于长期行为对照）');
  process.exit(2);
}
const src = fs.readFileSync(FROZEN, 'utf8');
function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到 ' + name);
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
  'HINT_RADIUS', 'WIN_SCORE', 'SEARCH_DEPTH', 'CANDIDATE_LIMIT', 'ROOT_CANDIDATE_LIMIT', 'SEARCH_BUDGET_MS',
  'MEDIUM_SEARCH_DEPTH', 'MEDIUM_SEARCH_BUDGET_MS',
  'VCF_MAX_PLIES', 'VCF_NODE_LIMIT', 'VCF_TIME_BUDGET_MS', 'VCT_MAX_PLIES', 'VCT_NODE_LIMIT', 'VCT_TIME_BUDGET_MS',
  'OPENING_TOTAL_MOVES', 'OPENING_DOUBLE_BONUS', 'CONNECT_BONUS', 'CENTER_WEIGHT', 'DOUBLE_THREAT_BONUS', 'TEMPO_BONUS',
  'LEVEL_EASY', 'LEVEL_MEDIUM', 'LEVEL_HARD', 'playerColor', 'aiColor', 'moveVariety', 'searchState',
  'lastVcfPath', 'lastVctPath', 'performance',
  'TT_MAX_ENTRIES', 'TT_EXACT', 'TT_LOWER', 'TT_UPPER', 'TT_SIDE_ME', 'TT_SIDE_OPP',
  'TT_PERSP_BLACK', 'TT_PERSP_WHITE', 'OPENING_BOOK', 'OPENING_BOOK_MAX_STONES', 'PATTERN_TABLE',
  'let ttMap=null;let ttZobrist=null;let boardHash=0;let historyTable=null;let killerTable=null;\n' + body +
  ';\nreturn {evaluateBoard,threatLevel,countThreats,evaluateCell,canWinNow,lineInfo,lineScore,' +
  'findImmediateWin,findVcfWin,findVctWin,findDoubleThreat,findDoubleKill,findOpponentDoubleThreat,' +
  'resolveThreats,scoreFor,getBestMove,getCandidateMoves,searchDepth,comboBonus,threatSpaceBonus,' +
  'forcingMovesOf,bookMove,pickVaried};');

const OPENING_BOOK = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'engine', 'opening-book.json'), 'utf8'));
const legacyBoard = Array.from({ length: S }, () => Array(S).fill(EMPTY));
const LEGACY = api(S, legacyBoard, EMPTY, BLACK, WHITE, WHITE, DIRECTIONS, 10000,
  2, 100000000, 3, 16, 18, 2500, 3, 400,
  10, 5000, 250, 10, 5000, 300,
  8, 20000, 30, 25, 30000, 1500,
  'easy', 'medium', 'hard', BLACK, WHITE, 0, null, null, null, { now: () => Date.now() },
  300000, 0, 1, 2, 0x9E3779B9, 0x85EBCA77, 0x6D2B79F5, 0x1B56C4E9,
  OPENING_BOOK, 8, AI.PATTERN_TABLE);

/* ---------- 随机局面生成（可复现：传第二个参数作为随机种子） ---------- */
let seed = Number(process.argv[3] || 12345) >>> 0;
function rnd() {                       // xorshift32：确定性伪随机
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
}
function randInt(n) { return Math.floor(rnd() * n); }
function makePosition(stones) {
  const b = Array.from({ length: S }, () => Array(S).fill(EMPTY));
  let placed = 0, guard = 0, r = 9, c = 9;
  while (placed < stones && guard++ < 8000) {
    if (b[r][c] === EMPTY) { b[r][c] = placed % 2 === 0 ? BLACK : WHITE; placed++; }
    r += randInt(3) - 1; c += randInt(3) - 1;
    if (r < 0 || r >= S || c < 0 || c >= S) { r = 9 + randInt(7) - 3; c = 9 + randInt(7) - 3; }
    if (r < 0 || r >= S || c < 0 || c >= S) { r = 9; c = 9; }
  }
  return b;
}
function sync(b) {
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) { AI.board[r][c] = b[r][c]; legacyBoard[r][c] = b[r][c]; }
}
const key = (a) => (a === null || a === undefined) ? 'null' : Array.isArray(a) ? a.join(',') : JSON.stringify(a);

/* ---------- 对比 ---------- */
const N = Number(process.argv[2] || 30);
let checks = 0, fails = 0;
const samples = [];
function cmp(label, what, a, l) {
  checks++;
  if (key(a) !== key(l)) {
    fails++;
    if (samples.length < 15) samples.push(`[${label}] ${what}\n    新: ${key(a)}\n    旧: ${key(l)}`);
  }
}

AI.setMoveVariety(0);   // 关闭随机，保证确定性（旧引擎用 moveVariety=0 构造）

console.log(`==== 引擎等价性验证：${N} 个随机局面，19 路，种子 ${process.argv[3] || 12345} ====`);
for (let t = 0; t < N; t++) {
  const stones = t % 3 === 0 ? 2 + randInt(6) : (t % 3 === 1 ? 11 + randInt(14) : 28 + randInt(18));
  const pos = makePosition(stones);
  sync(pos);
  const nb = pos.flat().filter(v => v === BLACK).length, nw = pos.flat().filter(v => v === WHITE).length;
  const label = `#${t}(黑${nb}/白${nw})`;

  /* 1) 评估函数 */
  cmp(label, 'evaluateBoard(白,combo=1,null)', AI.evaluateBoard(WHITE, BLACK, 1, null), LEGACY.evaluateBoard(WHITE, BLACK, 1, null));
  cmp(label, 'evaluateBoard(黑,combo=1,黑先)', AI.evaluateBoard(BLACK, WHITE, 1, BLACK), LEGACY.evaluateBoard(BLACK, WHITE, 1, BLACK));
  cmp(label, 'evaluateBoard(白,combo=0.25)', AI.evaluateBoard(WHITE, BLACK, 0.25, null), LEGACY.evaluateBoard(WHITE, BLACK, 0.25, null));

  /* 2) 纯棋型函数（逐格，最严格） */
  let cellMismatch = null;
  for (let r = 0; r < S && !cellMismatch; r++) {
    for (let c = 0; c < S; c++) {
      if (pos[r][c] !== EMPTY) continue;
      if (AI.threatLevel(r, c, BLACK) !== LEGACY.threatLevel(r, c, BLACK)) { cellMismatch = `threatLevel黑@${r},${c}`; break; }
      if (AI.threatLevel(r, c, WHITE) !== LEGACY.threatLevel(r, c, WHITE)) { cellMismatch = `threatLevel白@${r},${c}`; break; }
      if (AI.countThreats(r, c, BLACK) !== LEGACY.countThreats(r, c, BLACK)) { cellMismatch = `countThreats@${r},${c}`; break; }
      if (AI.evaluateCell(r, c, WHITE) !== LEGACY.evaluateCell(r, c, WHITE)) { cellMismatch = `evaluateCell@${r},${c}`; break; }
      if (AI.canWinNow(r, c, BLACK) !== LEGACY.canWinNow(r, c, BLACK)) { cellMismatch = `canWinNow@${r},${c}`; break; }
      if (AI.scoreFor(r, c, WHITE, BLACK) !== LEGACY.scoreFor(r, c, WHITE, BLACK)) { cellMismatch = `scoreFor@${r},${c}`; break; }
      if (key(AI.lineInfo(r, c, 1, 1, BLACK)) !== key(LEGACY.lineInfo(r, c, 1, 1, BLACK))) { cellMismatch = `lineInfo@${r},${c}`; break; }
    }
  }
  checks++;
  if (cellMismatch) { fails++; if (samples.length < 15) samples.push(`[${label}] 逐格函数不一致: ${cellMismatch}`); }

  /* 3) 战术函数 */
  cmp(label, 'findImmediateWin(黑)', AI.findImmediateWin(BLACK), LEGACY.findImmediateWin(BLACK));
  cmp(label, 'findImmediateWin(白)', AI.findImmediateWin(WHITE), LEGACY.findImmediateWin(WHITE));
  cmp(label, 'findVcfWin(黑)', AI.findVcfWin(BLACK), LEGACY.findVcfWin(BLACK));
  cmp(label, 'findVctWin(白)', AI.findVctWin(WHITE), LEGACY.findVctWin(WHITE));
  cmp(label, 'findDoubleThreat(黑)', AI.findDoubleThreat ? AI.findDoubleThreat(BLACK) : null, LEGACY.findDoubleThreat(BLACK));
  cmp(label, 'findDoubleKill(黑)', AI.findDoubleKill ? AI.findDoubleKill(BLACK) : null, LEGACY.findDoubleKill(BLACK));
  cmp(label, 'findOpponentDoubleThreat(白)', AI.findOpponentDoubleThreat ? AI.findOpponentDoubleThreat(WHITE) : null, LEGACY.findOpponentDoubleThreat(WHITE));

  /* 4) 候选生成与决策（AI 实际落子） */
  cmp(label, 'getCandidateMoves(黑,16)', LEGACY.getCandidateMoves(16, BLACK), LEGACY.getCandidateMoves(16, BLACK));
  cmp(label, 'getBestMove(medium,黑)', AI.getBestMove('medium', BLACK), LEGACY.getBestMove('medium', BLACK));
  cmp(label, 'getBestMove(hard,白)', AI.getBestMove('hard', WHITE), LEGACY.getBestMove('hard', WHITE));
  cmp(label, 'getBestMove(easy,黑)', AI.getBestMove('easy', BLACK), LEGACY.getBestMove('easy', BLACK));
}

console.log(`对比项 ${checks} 个，失败 ${fails} 个`);
if (fails) {
  console.log('\n失败样例:');
  for (const s of samples) console.log('  ' + s);
  process.exit(1);
}
console.log('全部一致：新模块与 HTML 内联引擎行为完全等价');
