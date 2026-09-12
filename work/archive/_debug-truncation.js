// 验证假设：根候选合并顺序 + 截断，导致“必挡点”虽然被收集却排不进搜索视野。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

function load(extraProbe) {
  let src = fs.readFileSync(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'), 'utf8');
  src = src.replace('    /* 决策与查询 */', '    criticalDefensePoints, tacticalCandidates,\n    /* 决策与查询 */');
  if (extraProbe) {
    src = src.replace('  let ordered = merged.map((m, i) => ({ r: m[0], c: m[1], idx: i }));',
      '  if (globalThis.__t) globalThis.__t.merged = merged.map(p => p.join(","));\n' +
      '  let ordered = merged.map((m, i) => ({ r: m[0], c: m[1], idx: i }));');
  }
  const sandbox = { module: { exports: {} }, console, performance: { now: () => Date.now() }, Math, JSON, Set, Map, Int32Array, Array, Object, Number, String, isNaN, parseInt, parseFloat, Infinity, NaN };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'engine-x.js' });
  return { A: sandbox.module.exports, sandbox };
}

const { A, sandbox } = load(true);
const BLACK = 1, WHITE = 2, EMPTY = 0;
A.setMoveVariety(0);
A.setBoardSize(19);
A.setColors(WHITE, BLACK);   // aiColor=WHITE（行动方）

const b = A.board;
for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY;
for (const [r, c] of [[10, 5], [10, 6], [8, 7], [9, 7]]) b[r][c] = BLACK;
for (const [r, c] of [[12, 12], [13, 13]]) b[r][c] = WHITE;

console.log('tacticalCandidates(白,黑) =', JSON.stringify(A.tacticalCandidates(WHITE, BLACK)));
console.log('criticalDefensePoints(黑) =', JSON.stringify(A.criticalDefensePoints(BLACK)));
console.log('ROOT_CANDIDATE_LIMIT =', A.ROOT_CANDIDATE_LIMIT, ' CANDIDATE_LIMIT =', A.CANDIDATE_LIMIT);

sandbox.__t = {};
const mv = A.getBestMove('medium', WHITE);
console.log('\n实际落点 =', JSON.stringify(mv));
const merged = sandbox.__t.merged || [];
console.log(`bestBySearch 内部 merged 候选 ${merged.length} 个:`, merged.join(' | '));
const hasDefense = merged.includes('10,7');
console.log('merged 是否含必挡点 10,7:', hasDefense);
if (hasDefense) console.log('  → 10,7 的序号（0 基）:', merged.indexOf('10,7'), '（越靠后越不容易被搜索充分评估）');
