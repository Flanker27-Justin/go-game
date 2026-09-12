// 诊断：困难档在真实对局各阶段实际搜到多深、耗时多少、预算是否被用满。
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
// 在 bestBySearch 里插桩：记录每层完成的深度与耗时
const instrumented = body.replace(
  /function bestBySearch\(([^)]*)\)\s*\{/,
  (m, args) => `function bestBySearch(${args}) {\n  globalThis.__probe = globalThis.__probe || { layers: [], maxDepth: 0, called: 0 };\n  globalThis.__probe.called++;`
).replace(
  /if \(dBest\) \{ bestMove = dBest; bestScore = dScore; \}/,
  'if (dBest) { bestMove = dBest; bestScore = dScore; globalThis.__probe.layers.push({ depth, ms: performance.now() - levelStart, rootCands: ordered.length }); }'
).replace(
  /const maxDepth = depthLimit > 0 \? Math\.min\(depthLimit, searchDepth\(\)\) : searchDepth\(\);/,
  'const maxDepth = depthLimit > 0 ? Math.min(depthLimit, searchDepth()) : searchDepth(); if (maxDepth > globalThis.__probe.maxDepth) globalThis.__probe.maxDepth = maxDepth;'
);

const f = new Function(
  'boardSize', 'board', 'EMPTY', 'BLACK', 'WHITE', 'AI_COLOR', 'DIRECTIONS', 'LIVE_THREE_SCORE',
  'HINT_RADIUS', 'WIN_SCORE', 'SEARCH_DEPTH', 'CANDIDATE_LIMIT', 'ROOT_CANDIDATE_LIMIT', 'SEARCH_BUDGET_MS', 'MEDIUM_SEARCH_DEPTH', 'MEDIUM_SEARCH_BUDGET_MS',
  'VCF_MAX_PLIES', 'VCF_NODE_LIMIT', 'VCF_TIME_BUDGET_MS', 'VCT_MAX_PLIES', 'VCT_NODE_LIMIT', 'VCT_TIME_BUDGET_MS',
  'OPENING_TOTAL_MOVES', 'OPENING_DOUBLE_BONUS', 'CONNECT_BONUS', 'CENTER_WEIGHT', 'DOUBLE_THREAT_BONUS', 'TEMPO_BONUS',
  'LEVEL_EASY', 'LEVEL_MEDIUM', 'LEVEL_HARD', 'playerColor', 'aiColor', 'moveVariety', 'searchState', 'lastVcfPath', 'lastVctPath', 'performance',
  'TT_MAX_ENTRIES', 'TT_EXACT', 'TT_LOWER', 'TT_UPPER', 'TT_SIDE_ME', 'TT_SIDE_OPP', 'TT_PERSP_BLACK', 'TT_PERSP_WHITE', 'OPENING_BOOK', 'OPENING_BOOK_MAX_STONES', 'PATTERN_TABLE',
  'let ttMap=null;let ttZobrist=null;let boardHash=0;let historyTable=null;let killerTable=null;\n' + instrumented + ';\nreturn {getBestMove,searchDepth};');

const S = 19;
const EMPTY = 0, BLACK = 1, WHITE = 2, AI_COLOR = WHITE;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const LIVE_THREE_SCORE = 10000, HINT_RADIUS = 2, WIN_SCORE = 100000000;
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
let playerColor = BLACK, aiColor = WHITE, moveVariety = 0;
let searchState = null, lastVcfPath = null, lastVctPath = null;
const performance = { now: () => Date.now() };
const board = Array.from({ length: S }, () => Array(S).fill(EMPTY));
function reset() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = EMPTY; }

const A = f(S, board, EMPTY, BLACK, WHITE, AI_COLOR, DIRECTIONS, LIVE_THREE_SCORE,
  HINT_RADIUS, WIN_SCORE, SEARCH_DEPTH, CANDIDATE_LIMIT, ROOT_CANDIDATE_LIMIT, SEARCH_BUDGET_MS, MEDIUM_SEARCH_DEPTH, MEDIUM_SEARCH_BUDGET_MS,
  VCF_MAX_PLIES, VCF_NODE_LIMIT, VCF_TIME_BUDGET_MS, VCT_MAX_PLIES, VCT_NODE_LIMIT, VCT_TIME_BUDGET_MS,
  OPENING_TOTAL_MOVES, OPENING_DOUBLE_BONUS, CONNECT_BONUS, CENTER_WEIGHT, DOUBLE_THREAT_BONUS, TEMPO_BONUS,
  LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD, playerColor, aiColor, moveVariety, searchState, lastVcfPath, lastVctPath, performance,
  TT_MAX_ENTRIES, TT_EXACT, TT_LOWER, TT_UPPER, TT_SIDE_ME, TT_SIDE_OPP, TT_PERSP_BLACK, TT_PERSP_WHITE, OPENING_BOOK, OPENING_BOOK_MAX_STONES, PATTERN_TABLE);

function hasFive(r, c, color) {
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

// 一局 AI vs AI，复用页面同一份 open 逻辑；记录每步实际到达的深度
reset();
board[9][9] = BLACK;
let stones = 1;
console.log('手数 | 轮到 | 耗时ms | 到达层深度(用时ms) | 该局面 searchDepth 上限 | 候选数');
while (stones < S * S && stones < 90) {
  const color = stones % 2 === 1 ? WHITE : BLACK;
  globalThis.__probe = { layers: [], maxDepth: 0, called: 0 };
  const t0 = Date.now();
  const mv = A.getBestMove(LEVEL_HARD, color);
  const dt = Date.now() - t0;
  const p = globalThis.__probe;
  if (p.called) {
    const layers = p.layers.map(l => `d${l.depth}:${l.ms}ms/${l.rootCands}根`).join(' ');
    console.log(`${String(stones).padStart(4)} | ${color === BLACK ? '黑' : '白'} | ${String(dt).padStart(5)} | ${layers || '（未进入搜索/战术层直接落子）'} | 上限${p.maxDepth} | `);
  } else {
    console.log(`${String(stones).padStart(4)} | ${color === BLACK ? '黑' : '白'} | ${String(dt).padStart(5)} | 战术层直接落子（未进搜索）`);
  }
  board[mv[0]][mv[1]] = color;
  stones++;
  if (hasFive(mv[0], mv[1], color)) { console.log(`→ ${color === BLACK ? '黑' : '白'}胜，共 ${stones} 手`); break; }
}
