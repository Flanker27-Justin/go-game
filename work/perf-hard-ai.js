// 困难档性能复测：19路 AI vs AI 完整对局，统计每步耗时。
'use strict';
const fs = require('fs');
const src = fs.readFileSync('outputs/gomoku.html', 'utf8');

function extractFn(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found: ' + name);
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
  'let ttMap=null;let ttZobrist=null;let boardHash=0;let historyTable=null;let killerTable=null;\n' + body + ';\nreturn {getBestMove,searchDepth};');

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
let moveVariety = 1;
let searchState = null;
let lastVcfPath = null;
let lastVctPath = null;
const performance = { now: () => Date.now() };

const board = Array.from({ length: S }, () => Array(S).fill(EMPTY));
function reset() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = EMPTY; }
const inB = (r, c) => r >= 0 && r < S && c >= 0 && c < S;

const A = api(S, board, EMPTY, BLACK, WHITE, AI_COLOR, DIRECTIONS, LIVE_THREE_SCORE,
              HINT_RADIUS, WIN_SCORE, SEARCH_DEPTH, CANDIDATE_LIMIT, ROOT_CANDIDATE_LIMIT, SEARCH_BUDGET_MS, MEDIUM_SEARCH_DEPTH, MEDIUM_SEARCH_BUDGET_MS,
              VCF_MAX_PLIES, VCF_NODE_LIMIT, VCF_TIME_BUDGET_MS, VCT_MAX_PLIES, VCT_NODE_LIMIT, VCT_TIME_BUDGET_MS,
              OPENING_TOTAL_MOVES, OPENING_DOUBLE_BONUS, CONNECT_BONUS, CENTER_WEIGHT, DOUBLE_THREAT_BONUS, TEMPO_BONUS,
              LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD, playerColor, aiColor, moveVariety, searchState, lastVcfPath, lastVctPath, performance,
              TT_MAX_ENTRIES, TT_EXACT, TT_LOWER, TT_UPPER, TT_SIDE_ME, TT_SIDE_OPP, TT_PERSP_BLACK, TT_PERSP_WHITE, OPENING_BOOK, OPENING_BOOK_MAX_STONES, PATTERN_TABLE);

const DIRECT = [[1, 0], [0, 1], [1, 1], [1, -1]];
function hasFive(r, c, color) {
  for (const [dr, dc] of DIRECT) {
    let n = 1;
    for (let k = 1; k < 5; k++) { const rr = r + dr * k, cc = c + dc * k; if (!inB(rr, cc) || board[rr][cc] !== color) break; n++; }
    for (let k = 1; k < 5; k++) { const rr = r - dr * k, cc = c - dc * k; if (!inB(rr, cc) || board[rr][cc] !== color) break; n++; }
    if (n >= 5) return true;
  }
  return false;
}

function playGame(gameNo) {
  reset();
  const times = [];
  const moves = [];
  let winner = null;
  board[9][9] = BLACK; // 黑先占天元
  let stones = 1;
  let plies = 0;
  const MAX_PLIES = 150;
  while (stones < S * S && plies < MAX_PLIES) {
    const color = stones % 2 === 1 ? WHITE : BLACK; // 第2手起交替（黑已下第1手）
    const t0 = Date.now();
    const mv = color === WHITE ? A.getBestMove(LEVEL_HARD) : A.getBestMove(LEVEL_HARD, BLACK);
    const dt = Date.now() - t0;
    let r, c;
    if (mv && inB(mv[0], mv[1]) && board[mv[0]][mv[1]] === EMPTY) { r = mv[0]; c = mv[1]; }
    else { r = 9; c = 9; for (let rad = 1; rad < S; rad++) { let found = false; for (let dr = -rad; dr <= rad && !found; dr++) for (let dc = -rad; dc <= rad && !found; dc++) { const rr = 9 + dr, cc = 9 + dc; if (inB(rr, cc) && board[rr][cc] === EMPTY) { r = rr; c = cc; found = true; } } if (found) break; } }
    board[r][c] = color;
    stones++;
    plies++;
    times.push(dt);
    moves.push({ ply: plies, color: color === BLACK ? 'B' : 'W', cell: [r, c], ms: dt });
    if (hasFive(r, c, color)) { winner = color === BLACK ? 'BLACK' : 'WHITE'; break; }
  }
  return { gameNo, times, moves, winner, plies, stones };
}

const games = [];
const winPly = (res) => res.winner ? res.plies : res.plies;
const allTimes = [];
for (let g = 1; g <= 10; g++) {
  const res = playGame(g);
  games.push(res);
  allTimes.push(...res.times);
  const maxT = Math.max(...res.times);
  const overBudget = res.times.filter(t => t > 2500).length;
  const over3s = res.times.filter(t => t > 3000).length;
  const mid = res.moves.filter(m => m.ply >= 35 && m.ply <= 60);
  const midMax = mid.length ? Math.max(...mid.map(m => m.ms)) : 0;
  const late = res.moves.filter(m => m.ply >= 60);
  const lateMax = late.length ? Math.max(...late.map(m => m.ms)) : 0;
  console.log(`Game ${g}: ${res.plies} plies, winner=${res.winner}, max=${maxT}ms, >2500ms=${overBudget}, >3000ms=${over3s}, mid(35-60)max=${midMax}ms, late(60+)max=${lateMax}ms`);
  console.log('  slowest 5: ' + res.moves.slice().sort((a, b) => b.ms - a.ms).slice(0, 5).map(m => `#${m.ply}${m.color}${m.ms}ms`).join(' '));
}
const overallMax = Math.max(...allTimes);
const overB = allTimes.filter(t => t > 2500).length;
const over3 = allTimes.filter(t => t > 3000).length;
console.log(`\nTOTAL: ${allTimes.length} moves, overallMax=${overallMax}ms, >2500ms=${overB}, >3000ms=${over3}`);
console.log(overallMax <= 3000 ? 'PERF PASS' : 'PERF FAIL');


