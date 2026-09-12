// 插桩源码：在 bestBySearch 根循环里打印每个候选的得分，定位搜索为何弃优。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let src = fs.readFileSync(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'), 'utf8');

/* 在根循环里插入日志：记录每个候选与得分 */
const anchor = '      scored.push({ r, c, idx, v });';
if (!src.includes(anchor)) throw new Error('找不到根循环锚点');
src = src.replace(anchor,
  '      if (globalThis.__trace) globalThis.__trace.push({ r, c, idx, v });\n' + anchor);

/* 在 bestBySearch 开头记录候选规模 */
const anchor2 = '  let ordered = merged.map((m, i) => ({ r: m[0], c: m[1], idx: i }));';
if (!src.includes(anchor2)) throw new Error('找不到 ordered 锚点');
src = src.replace(anchor2,
  '  if (globalThis.__trace) globalThis.__trace.push({ stage: "root-candidates", count: merged.length, pts: merged.map(p => p.join(",")).join(" ") });\n' + anchor2);

const sandbox = { module: { exports: {} }, console, performance: { now: () => Date.now() }, Math, JSON, Set, Map, Int32Array, Array, Object, Number, String, isNaN, parseInt, parseFloat, Infinity, NaN, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'engine-traced.js' });
const A = sandbox.module.exports;
const BLACK = 1, WHITE = 2, EMPTY = 0;
A.setMoveVariety(0);
A.setBoardSize(19);
A.setColors(WHITE, BLACK);

function setup(stones) {
  const b = A.board;
  for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = EMPTY;
  for (const [color, cells] of Object.entries(stones)) for (const [r, c] of cells) b[r][c] = Number(color);
}

function trace(label, stones, level) {
  setup(stones);
  sandbox.__trace = [];
  const mv = A.getBestMove(level, BLACK);
  console.log(`\n=== ${label} (${level}) → ${JSON.stringify(mv)} ===`);
  const root = sandbox.__trace.find(t => t.stage === 'root-candidates');
  if (root) console.log(`  根候选 ${root.count} 个: ${root.pts}`);
  const scores = sandbox.__trace.filter(t => t.stage === undefined);
  scores.sort((a, b) => b.v - a.v);
  console.log('  根候选得分（降序前 8）:');
  for (const s of scores.slice(0, 8)) console.log(`    (${s.r},${s.c}) idx=${s.idx} v=${s.v}`);
  const livefour = scores.filter(s => s.r === 0 && (s.c === 1 || s.c === 5));
  if (livefour.length) console.log('  活四点得分:', JSON.stringify(livefour));
}

// 局面1：角部活三（失败）
trace('角部活三 (0,2)(0,3)(0,4)', { 1: [[0, 2], [0, 3], [0, 4]], 2: [[5, 5], [6, 6]] }, 'medium');
// 局面2：中间活三（成功）
trace('中间活三 (10,8)(10,9)(10,10)', { 1: [[10, 8], [10, 9], [10, 10]], 2: [[3, 3], [4, 4]] }, 'medium');
// 局面3：活二（失败）
trace('活二 (10,5)(10,6)', { 1: [[10, 5], [10, 6]], 2: [[2, 2], [2, 3]] }, 'medium');
