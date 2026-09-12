// 诊断：pattern 分值表改动是否真的改变了引擎的落子选择？
// 方法：让两套引擎在同一局面下逐手决策并对比落点，找到第一处分歧。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const S = 19, EMPTY = 0, BLACK = 1, WHITE = 2;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

function loadEngine(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = { module: { exports: {} }, console, performance: { now: () => Date.now() }, Math, JSON, Set, Map, Int32Array, Array, Object, Number, String, isNaN, parseInt, parseFloat, Infinity, NaN };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: path.basename(file) });
  const api = sandbox.module.exports;
  api.setMoveVariety(0);
  api.setBoardSize(S);
  return api;
}

const NEW = loadEngine(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'));
const OLD = loadEngine(path.join(ROOT, 'work', 'archive', '_engine-baseline.js'));

console.log('新版 PATTERN_TABLE[4] =', JSON.stringify(NEW.PATTERN_TABLE[4]));
console.log('旧版 PATTERN_TABLE[4] =', JSON.stringify(OLD.PATTERN_TABLE[4]));

const judge = Array.from({ length: S }, () => Array(S).fill(EMPTY));
function syncTo(e) { const b = e.board; for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) b[r][c] = judge[r][c]; }
function hasFive(r, c, color) {
  for (const [dr, dc] of DIRECTIONS) {
    let n = 1;
    for (const k of [1, -1]) for (let i = 1; i < 5; i++) {
      const rr = r + dr * i * k, cc = c + dc * i * k;
      if (rr < 0 || rr >= S || cc < 0 || cc >= S || judge[rr][cc] !== color) break;
      n++;
    }
    if (n >= 5) return true;
  }
  return false;
}

judge[9][9] = BLACK;
let stones = 1, firstDivergence = null, diversions = 0;
console.log('\n手数 | 行动 | 新版落点 | 旧版落点 | 是否一致');
while (stones < 80) {
  const color = stones % 2 === 1 ? WHITE : BLACK;
  syncTo(NEW); syncTo(OLD);
  const t0 = Date.now();
  const mn = NEW.getBestMove('hard', color);
  const t1 = Date.now();
  const mo = OLD.getBestMove('hard', color);
  const t2 = Date.now();
  const same = mn && mo && mn[0] === mo[0] && mn[1] === mo[1];
  if (!same) {
    diversions++;
    if (!firstDivergence) firstDivergence = { stones, color, mn, mo };
  }
  if (stones <= 8 || !same) {
    console.log(`${String(stones).padStart(4)} | ${color === BLACK ? '黑' : '白'} | ` +
      `${mn ? mn.join(',') : 'null'}(新${t1 - t0}ms) | ${mo ? mo.join(',') : 'null'}(旧${t2 - t1}ms) | ${same ? '一致' : '★分歧'}`);
  }
  if (!mn) break;
  judge[mn[0]][mn[1]] = color;   // 以新版主线继续
  stones++;
  if (hasFive(mn[0], mn[1], color)) break;
}
console.log(`\n共 ${stones} 手，落点分歧 ${diversions} 处`);
if (firstDivergence) {
  console.log(`首次分歧在第 ${firstDivergence.stones} 手（${firstDivergence.color === BLACK ? '黑' : '白'}）：新 ${firstDivergence.mn} vs 旧 ${firstDivergence.mo}`);
} else {
  console.log('两版着法完全相同 → 该改动目前对实际决策没有任何影响（棋型分值未被决策路径使用）');
}
