// 量化实验 v2：正确地把“搜索时间预算”注入两套引擎（替换源码中的 SEARCH_BUDGET_MS），
// 再让高预算困难档 vs 标准困难档对弈，看时间预算能否换来胜率。
'use strict';
const fs = require('fs');
let src = fs.readFileSync('outputs/gomoku.html', 'utf8');

function extractFn(name, text) {
  const t = text || src;
  const start = t.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数 ' + name);
  const brace = t.indexOf('{', t.indexOf(')', start));
  let depth = 0, i = brace;
  for (; i < t.length; i++) {
    const ch = t[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return t.slice(start, i + 1);
}

const fns = ['inBoard', 'lineInfo', 'lineScore', 'directionScore', 'evaluateCell',
             'threatLevel', 'scoreFor', 'resolveThreats', 'canWinNow', 'findImmediateWin',
             'getCandidateMoves', 'evaluateBoard', 'comboBonus', 'countThreats', 'threatSpaceBonus',
             'minimax', 'bestBySearch', 'bestByScore', 'getBestMove', 'searchDepth', 'forcingMovesOf',
             'findVcfWin', 'vcfSearch', 'vcfForcingMoves', 'vcfBlockPoints',
             'findVctWin', 'vctSearch', 'vctForcingMoves', 'vctBlockPoints', 'vctDefense',
             'findDoubleThreat', 'findOpponentDoubleThreat', 'openingMove',
             'pickVaried', 'pickTopN', 'initSearchTables', 'hashXor', 'ttStore', 'findDoubleKill', 'bookMove'];

const S = 19;
const EMPTY = 0, BLACK = 1, WHITE = 2, AI_COLOR = WHITE;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const LIVE_THREE_SCORE = 10000;
const HINT_RADIUS = 2;
const WIN_SCORE = 100000000;
const SEARCH_DEPTH = 3, CANDIDATE_LIMIT = 16, ROOT_CANDIDATE_LIMIT = 18;
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
const performance = { now: () => Date.now() };

// 为每个实例生成独立源码：把 SEARCH_BUDGET_MS 常量闭包掉，避免两个实例共享
function makeEngine(budget) {
  const body = fns.map(n => extractFn(n)).join('\n');
  const f = new Function(
    'boardSize', 'board', 'EMPTY', 'BLACK', 'WHITE', 'AI_COLOR', 'DIRECTIONS', 'LIVE_THREE_SCORE',
    'HINT_RADIUS', 'WIN_SCORE', 'SEARCH_DEPTH', 'CANDIDATE_LIMIT', 'ROOT_CANDIDATE_LIMIT', 'MEDIUM_SEARCH_DEPTH', 'MEDIUM_SEARCH_BUDGET_MS',
    'VCF_MAX_PLIES', 'VCF_NODE_LIMIT', 'VCF_TIME_BUDGET_MS', 'VCT_MAX_PLIES', 'VCT_NODE_LIMIT', 'VCT_TIME_BUDGET_MS',
    'OPENING_TOTAL_MOVES', 'OPENING_DOUBLE_BONUS', 'CONNECT_BONUS', 'CENTER_WEIGHT', 'DOUBLE_THREAT_BONUS', 'TEMPO_BONUS',
    'LEVEL_EASY', 'LEVEL_MEDIUM', 'LEVEL_HARD', 'playerColor', 'aiColor', 'moveVariety', 'searchState', 'lastVcfPath', 'lastVctPath', 'performance',
    'TT_MAX_ENTRIES', 'TT_EXACT', 'TT_LOWER', 'TT_UPPER', 'TT_SIDE_ME', 'TT_SIDE_OPP', 'TT_PERSP_BLACK', 'TT_PERSP_WHITE', 'OPENING_BOOK', 'OPENING_BOOK_MAX_STONES', 'PATTERN_TABLE',
    'const SEARCH_BUDGET_MS = ' + budget + ';\n' +
    'let ttMap=null;let ttZobrist=null;let boardHash=0;let historyTable=null;let killerTable=null;\n' + body +
    ';\nreturn {getBestMove,searchDepth};');
  const board = Array.from({ length: S }, () => Array(S).fill(EMPTY));
  let playerColor = BLACK, aiColor = WHITE, moveVariety = 0;
  let searchState = null, lastVcfPath = null, lastVctPath = null;
  const api = f(S, board, EMPTY, BLACK, WHITE, AI_COLOR, DIRECTIONS, LIVE_THREE_SCORE,
    HINT_RADIUS, WIN_SCORE, SEARCH_DEPTH, CANDIDATE_LIMIT, ROOT_CANDIDATE_LIMIT, MEDIUM_SEARCH_DEPTH, MEDIUM_SEARCH_BUDGET_MS,
    VCF_MAX_PLIES, VCF_NODE_LIMIT, VCF_TIME_BUDGET_MS, VCT_MAX_PLIES, VCT_NODE_LIMIT, VCT_TIME_BUDGET_MS,
    OPENING_TOTAL_MOVES, OPENING_DOUBLE_BONUS, CONNECT_BONUS, CENTER_WEIGHT, DOUBLE_THREAT_BONUS, TEMPO_BONUS,
    LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD, playerColor, aiColor, moveVariety, searchState, lastVcfPath, lastVctPath, performance,
    TT_MAX_ENTRIES, TT_EXACT, TT_LOWER, TT_UPPER, TT_SIDE_ME, TT_SIDE_OPP, TT_PERSP_BLACK, TT_PERSP_WHITE, OPENING_BOOK, OPENING_BOOK_MAX_STONES, PATTERN_TABLE);
  return { api, board, budget };
}

function syncTo(eng, board) { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) eng.board[r][c] = board[r][c]; }
function hasFive(board, r, c, color) {
  for (const [dr, dc] of DIRECTIONS) {
    let n = 1;
    for (const k of [1, -1]) for (let i = 1; i < 5; i++) {
      const rr = r + dr * i * k, cc = c + dc * i * k;
      if (rr < 0 || rr >= S || cc < 0 || cc >= S || board[rr][cc] !== color) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}

const board = Array.from({ length: S }, () => Array(S).fill(EMPTY));
function reset() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = EMPTY; }

function playMatch(budgetHi, budgetLo, games, verbose) {
  let hiWins = 0, loWins = 0, draws = 0;
  const hiTimes = [], loTimes = [], plies = [];
  for (let g = 0; g < games; g++) {
    reset();
    const A = makeEngine(budgetHi), B = makeEngine(budgetLo);
    const hiIsBlack = g % 2 === 0;
    board[9][9] = BLACK;
    let stones = 1, winner = null;
    while (stones < S * S && stones < 200) {
      const color = stones % 2 === 1 ? WHITE : BLACK;
      const isHi = (color === BLACK) === hiIsBlack;
      const eng = isHi ? A : B;
      syncTo(eng, board);
      const t0 = Date.now();
      const mv = eng.api.getBestMove(LEVEL_HARD, color);
      const dt = Date.now() - t0;
      (isHi ? hiTimes : loTimes).push(dt);
      let r, c, ok = false;
      if (mv && mv[0] >= 0 && mv[0] < S && mv[1] >= 0 && mv[1] < S && board[mv[0]][mv[1]] === EMPTY) { r = mv[0]; c = mv[1]; ok = true; }
      if (!ok) {
        for (let rad = 1; rad < S && !ok; rad++)
          for (let dr = -rad; dr <= rad && !ok; dr++)
            for (let dc = -rad; dc <= rad && !ok; dc++) {
              const rr = 9 + dr, cc = 9 + dc;
              if (rr >= 0 && rr < S && cc >= 0 && cc < S && board[rr][cc] === EMPTY) { r = rr; c = cc; ok = true; }
            }
      }
      board[r][c] = color;
      stones++;
      if (hasFive(board, r, c, color)) { winner = color; break; }
    }
    plies.push(stones);
    if (!winner) draws++;
    else if ((winner === BLACK) === hiIsBlack) hiWins++;
    else loWins++;
    if (verbose) console.log(`  局${g + 1}: ${stones} 手, 胜方=${winner === null ? '和' : (winner === BLACK ? '黑' : '白')} (高预算方执${hiIsBlack ? '黑' : '白'})`);
  }
  const avg = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
  return { hiWins, loWins, draws, hiAvg: avg(hiTimes), loAvg: avg(loTimes), hiMax: Math.max(...hiTimes, 0), loMax: Math.max(...loTimes, 0), avgPlies: avg(plies) };
}

const G = Number(process.argv[2] || 6);
console.log(`== 高预算困难档(6000ms) vs 标准困难档(2500ms)，${G} 局，交替执黑 ==`);
const r = playMatch(6000, 2500, G, true);
console.log(`\n高预算 胜 ${r.hiWins} / 标准 胜 ${r.loWins} / 和 ${r.draws}`);
console.log(`平均耗时 高预算=${r.hiAvg}ms(最大 ${r.hiMax}) 标准=${r.loAvg}ms(最大 ${r.loMax})；平均总手数=${r.avgPlies}`);
console.log(r.hiWins > r.loWins
  ? '→ 时间预算能显著提升棋力：说明搜索还有加深空间（当前深度/剪枝不是瓶颈，时间才是）'
  : '→ 给再多时间也赢不了：瓶颈在评估函数与剪枝质量，而不在时间');
