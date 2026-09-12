// 诊断：统计“哪一层决策在真正落子”，以及关键杠杆（VCF 深度/节点上限、搜索预算、候选宽度）对强度的影响。
'use strict';
const fs = require('fs');
const src = fs.readFileSync('outputs/gomoku.html', 'utf8');

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
const LIVE_THREE_SCORE = 10000, HINT_RADIUS = 2, WIN_SCORE = 100000000;
const SEARCH_DEPTH = 3;
const MEDIUM_SEARCH_DEPTH = 3, MEDIUM_SEARCH_BUDGET_MS = 400;
const OPENING_TOTAL_MOVES = 8, OPENING_DOUBLE_BONUS = 20000;
const CONNECT_BONUS = 30, CENTER_WEIGHT = 25, DOUBLE_THREAT_BONUS = 30000, TEMPO_BONUS = 1500;
const TT_MAX_ENTRIES = 300000, TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2, TT_SIDE_ME = 0x9E3779B9, TT_SIDE_OPP = 0x85EBCA77;
const TT_PERSP_BLACK = 0x6D2B79F5, TT_PERSP_WHITE = 0x1B56C4E9;
const OPENING_BOOK = JSON.parse(fs.readFileSync('work/opening-book.json', 'utf8'));
const OPENING_BOOK_MAX_STONES = 8;
const PATTERN_TABLE = [[0,0,0],[10,10,100],[100,100,1000],[1000,1000,10000],[10000,10000,100000],[1000000,1000000,1000000]];
const LEVEL_EASY = 'easy', LEVEL_MEDIUM = 'medium', LEVEL_HARD = 'hard';
const performance = { now: () => Date.now() };

function buildEngine(cfg) {
  const body = fns.map(n => extractFn(n)).join('\n');
  const f = new Function(
    'boardSize', 'board', 'EMPTY', 'BLACK', 'WHITE', 'AI_COLOR', 'DIRECTIONS', 'LIVE_THREE_SCORE',
    'HINT_RADIUS', 'WIN_SCORE', 'SEARCH_DEPTH', 'MEDIUM_SEARCH_DEPTH', 'MEDIUM_SEARCH_BUDGET_MS',
    'OPENING_TOTAL_MOVES', 'OPENING_DOUBLE_BONUS', 'CONNECT_BONUS', 'CENTER_WEIGHT', 'DOUBLE_THREAT_BONUS', 'TEMPO_BONUS',
    'LEVEL_EASY', 'LEVEL_MEDIUM', 'LEVEL_HARD', 'playerColor', 'aiColor', 'moveVariety', 'searchState', 'lastVcfPath', 'lastVctPath', 'performance',
    'TT_EXACT', 'TT_LOWER', 'TT_UPPER', 'TT_SIDE_ME', 'TT_SIDE_OPP', 'TT_PERSP_BLACK', 'TT_PERSP_WHITE', 'OPENING_BOOK', 'OPENING_BOOK_MAX_STONES', 'PATTERN_TABLE',
    `const SEARCH_BUDGET_MS = ${cfg.searchBudget};
     const CANDIDATE_LIMIT = ${cfg.candLimit};
     const ROOT_CANDIDATE_LIMIT = ${cfg.rootLimit};
     const VCF_MAX_PLIES = ${cfg.vcfPlies};
     const VCF_NODE_LIMIT = ${cfg.vcfNodes};
     const VCF_TIME_BUDGET_MS = ${cfg.vcfMs};
     const VCT_MAX_PLIES = ${cfg.vctPlies};
     const VCT_NODE_LIMIT = ${cfg.vctNodes};
     const VCT_TIME_BUDGET_MS = ${cfg.vctMs};
     const TT_MAX_ENTRIES = ${cfg.ttEntries};
     let ttMap=null;let ttZobrist=null;let boardHash=0;let historyTable=null;let killerTable=null;\n` + body +
    ';\nreturn {getBestMove,searchDepth};');
  const board = Array.from({ length: S }, () => Array(S).fill(EMPTY));
  let playerColor = BLACK, aiColor = WHITE, moveVariety = 0;
  let searchState = null, lastVcfPath = null, lastVctPath = null;
  const api = f(S, board, EMPTY, BLACK, WHITE, AI_COLOR, DIRECTIONS, LIVE_THREE_SCORE,
    HINT_RADIUS, WIN_SCORE, SEARCH_DEPTH, MEDIUM_SEARCH_DEPTH, MEDIUM_SEARCH_BUDGET_MS,
    OPENING_TOTAL_MOVES, OPENING_DOUBLE_BONUS, CONNECT_BONUS, CENTER_WEIGHT, DOUBLE_THREAT_BONUS, TEMPO_BONUS,
    LEVEL_EASY, LEVEL_MEDIUM, LEVEL_HARD, playerColor, aiColor, moveVariety, searchState, lastVcfPath, lastVctPath, performance,
    TT_EXACT, TT_LOWER, TT_UPPER, TT_SIDE_ME, TT_SIDE_OPP, TT_PERSP_BLACK, TT_PERSP_WHITE, OPENING_BOOK, OPENING_BOOK_MAX_STONES, PATTERN_TABLE);
  return { api, board, cfg };
}

const BASE = {
  searchBudget: 2500, candLimit: 16, rootLimit: 18,
  vcfPlies: 10, vcfNodes: 5000, vcfMs: 250,
  vctPlies: 10, vctNodes: 5000, vctMs: 300,
  ttEntries: 300000,
};

const board = Array.from({ length: S }, () => Array(S).fill(EMPTY));
function reset() { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = EMPTY; }
function syncTo(eng) { for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) eng.board[r][c] = board[r][c]; }
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

function play(cfgA, cfgB, games) {
  let aWins = 0, bWins = 0, draws = 0, aTime = 0, bTime = 0, plies = 0;
  for (let g = 0; g < games; g++) {
    reset();
    const A = buildEngine(cfgA), B = buildEngine(cfgB);
    const aIsBlack = g % 2 === 0;
    board[9][9] = BLACK;
    let stones = 1, winner = null;
    while (stones < S * S && stones < 200) {
      const color = stones % 2 === 1 ? WHITE : BLACK;
      const isA = (color === BLACK) === aIsBlack;
      const eng = isA ? A : B;
      syncTo(eng);
      const t0 = Date.now();
      const mv = eng.api.getBestMove(LEVEL_HARD, color);
      const dt = Date.now() - t0;
      if (isA) aTime += dt; else bTime += dt;
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
      if (hasFive(r, c, color)) { winner = color; break; }
    }
    plies += stones;
    if (!winner) draws++;
    else if ((winner === BLACK) === aIsBlack) aWins++; else bWins++;
  }
  return { aWins, bWins, draws, aAvg: Math.round(aTime / Math.max(1, aWins + bWins + draws) / (plies / (aWins + bWins + draws)) * 10) / 10, plies: Math.round(plies / games) };
}

const G = Number(process.argv[2] || 6);

function show(label, res) {
  console.log(`${label}: A胜${res.aWins} B胜${res.bWins} 和${res.draws} (平均总手数${res.plies})`);
}

console.log('== 实验1：加深 VCF（连续冲四）搜索 —— 10层/5000节点/250ms  基准 vs 加倍 ==');
show('基准 vs VCF加倍(20层/20000节点/800ms)', play(BASE, { ...BASE, vcfPlies: 20, vcfNodes: 20000, vcfMs: 800 }, G));

console.log('');
console.log('== 实验2：加大搜索预算与候选宽度（2.5s/16/18 vs 10s/24/30）==');
show('基准 vs 宽搜索(10s/24候选)', play(BASE, { ...BASE, searchBudget: 10000, candLimit: 24, rootLimit: 30 }, G));

console.log('');
console.log('== 实验3：加大 VCT（连续活三）窗口（10层/5000/300ms vs 16层/20000/1200ms）==');
show('基准 vs 宽VCT(16层/20000节点/1200ms)', play(BASE, { ...BASE, vctPlies: 16, vctNodes: 20000, vctMs: 1200 }, G));
