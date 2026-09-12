// 开局库生成器 v2：复用引擎**自己的**搜索为开局局面生成 top-N 应答。
//
// 背景：原生成器用 minimax(2) 即深度 2 生成前 8 手的应答，判断力极弱。
// 本版做法：给引擎临时打一个“暴露根候选打分”的口子（只在生成脚本内使用，
// 不改动正式引擎文件），然后对每个规范化局面取 top-5 应答，权重仍为 5..1。
//
// 用法:
//   node work/gen-opening-book2.js [--depth 3] [--budget 1500] [--stones 8]
//                                  [--out work/opening-book-deep.json]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const argv = process.argv.slice(2);
const argVal = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DEPTH = Number(argVal('depth', 3));         // minimax 递归层数（根之外）
const BUDGET = Number(argVal('budget', 1500));    // 每个局面的搜索预算 ms
const MAX_STONES = Number(argVal('stones', 8));
const OUT = path.resolve(ROOT, argVal('out', 'work/opening-book-deep.json'));
const S = 19, EMPTY = 0, BLACK = 1, WHITE = 2, CENTER = 9;
const W = [5, 4, 3, 2, 1];

/* ---------- 给引擎打口子：暴露“对给定根候选逐点打分”的内部能力 ---------- */
function loadEngineWithRootScores() {
  let src = fs.readFileSync(ENGINE, 'utf8');
  /* 1) 把 searchDepth 的上限抬高，确保 DEPTH 生效 */
  src = src.replace(/if \(placed >= 60\) return \d+;/, `if (placed >= 60) return ${DEPTH + 2};`);
  src = src.replace(/if \(placed >= 35\) return \d+;/, `if (placed >= 35) return ${DEPTH + 1};`);
  src = src.replace(/  return 3;/, `  return ${DEPTH + 1};`);
  /* 2) 暴露一个 rootScores()：用引擎自己的 minimax 对根候选逐点打分 */
  const API_ANCHOR = '    setWindowEval(v) { useWindowEval = !!v; },';
  const probe = `
    /** 仅供开局库生成：对根候选逐点跑引擎自身的 minimax（固定 DEPTH 层），返回降序列表 */
    rootScores(me, opp, depth, candLimit) {
      initSearchTables();
      searchState = { t0: performance.now(), budget: 1e9, rootDepth: depth };
      const moves = getCandidateMoves(candLimit || 18, me);
      const out = [];
      for (const [r, c] of moves) {
        board[r][c] = me;
        hashXor(r, c, me);
        const v = minimax(depth, -Infinity, Infinity, false, me, opp);
        hashXor(r, c, me);
        board[r][c] = EMPTY;
        out.push({ r, c, v });
      }
      out.sort((a, b) => b.v - a.v || a.r - b.r || a.c - b.c);
      return out;
    },`;
  if (src.includes(API_ANCHOR)) src = src.replace(API_ANCHOR, API_ANCHOR + probe);
  else if (src.includes('    setMoveVariety(v) { moveVariety = v; },'))
    src = src.replace('    setMoveVariety(v) { moveVariety = v; },', '    setMoveVariety(v) { moveVariety = v; },' + probe);
  else throw new Error('找不到插入 rootScores 的 API 锚点');

  const sandbox = {
    module: { exports: {} }, console, performance: { now: () => Date.now() },
    Math, JSON, Set, Map, Int32Array, Array, Object, Number, String,
    isNaN, parseInt, parseFloat, Infinity, NaN,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'engine-book.js' });
  const api = sandbox.module.exports;
  if (typeof api.rootScores !== 'function') throw new Error('rootScores 注入失败');
  api.setBoardSize(S);
  api.setMoveVariety(0);
  return api;
}

const A = loadEngineWithRootScores();
const board = A.board;

/* ---------- 8 对称规范化（与引擎 bookMove 一致） ---------- */
const SYM = [
  (x, y) => [x, y], (x, y) => [-y, x], (x, y) => [-x, -y], (x, y) => [y, -x],
  (x, y) => [x, -y], (x, y) => [-x, y], (x, y) => [y, x], (x, y) => [-y, -x],
];
function canonKey(side) {
  let best = null;
  for (let s = 0; s < 8; s++) {
    const pts = [];
    for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
      const color = board[r][c];
      if (color === EMPTY) continue;
      const [tx, ty] = SYM[s](r - CENTER, c - CENTER);
      pts.push([tx, ty, color]);
    }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    const str = pts.map(p => p.join(',')).join(';');
    if (best === null || str < best) best = str;
  }
  return (side === BLACK ? 'B|' : 'W|') + best;
}

/* ---------- 递归展开 ---------- */
const book = {};
const visited = new Set();
let done = 0;
const t0 = Date.now();

function expand(stones, me, level) {
  const opp = me === BLACK ? WHITE : BLACK;
  const topN = level === 0 ? 1 : (level <= 2 ? 5 : level === 3 ? 4 : 3);
  const expandCount = level === 0 ? 1 : level === 1 ? 6 : level === 2 ? 5 : level === 3 ? 4
    : level === 4 ? 3 : level === 5 ? 3 : level === 6 ? 2 : level === 7 ? 1 : 0;

  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) board[r][c] = EMPTY;
  for (const s of stones) board[s.r][s.c] = s.color;

  let scored;
  if (level === 0) {
    scored = [{ r: CENTER, c: CENTER, v: 0 }];
  } else {
    if (stones.length > MAX_STONES) return;
    const key = canonKey(me);
    if (visited.has(key)) return;
    visited.add(key);
    scored = A.rootScores(me, opp, DEPTH, 18);
    if (!scored.length) return;
    const top = scored.slice(0, Math.min(topN, scored.length));
    book[key] = top.map((s, i) => [s.r - CENTER, s.c - CENTER, W[i] || 1]);
    done++;
    if (done % 50 === 0) {
      console.log(`  已处理 ${done} 局面 / 库 ${Object.keys(book).length} 键 / ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    if (level >= expandCount) return;
    const next = scored.slice(0, Math.min(expandCount, scored.length));
    for (const s of next) {
      if (board[s.r][s.c] !== EMPTY) continue;
      board[s.r][s.c] = me;
      stones.push({ r: s.r, c: s.c, color: me });
      expand(stones, opp, level + 1);
      stones.pop();
      board[s.r][s.c] = EMPTY;
    }
    return;
  }
  /* level 0：首手天元，然后展开白方应答 */
  board[CENTER][CENTER] = BLACK;
  stones.push({ r: CENTER, c: CENTER, color: BLACK });
  expand(stones, WHITE, 1);
  stones.pop();
  board[CENTER][CENTER] = EMPTY;
}

console.log(`==== 生成开局库（minimax 深度 ${DEPTH}，覆盖 0~${MAX_STONES} 子）====`);
expand([], WHITE, 0);
const keys = Object.keys(book);
const entries = keys.reduce((n, k) => n + book[k].length, 0);
console.log(`\n完成：键 ${keys.length}，应答条目 ${entries}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (keys.length < 100) { console.log('!! 键数异常偏少，未写文件'); process.exit(1); }
fs.writeFileSync(OUT, JSON.stringify(book), 'utf8');
console.log('已写出: ' + path.relative(ROOT, OUT));
const old = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'engine', 'opening-book.json'), 'utf8'));
const oldKeys = new Set(Object.keys(old));
const same = keys.filter(k => oldKeys.has(k)).length;
console.log(`覆盖度对比：新库 ${keys.length} 键（共同 ${same}） / 旧库 ${oldKeys.size} 键`);
