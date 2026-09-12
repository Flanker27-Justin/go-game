// 判定实验：给生成的模块补上 publicFn 包装（模板的接口设计意图），
// 看"所有局面都返回同一个点"的问题是否消失。若消失，说明改造只差这层接线。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let src = fs.readFileSync(path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js'), 'utf8');

/* 在对外返回对象之前，把查询类函数包一层 */
const NEED = ['getBestMove', 'bestBySearch', 'bestByScore', 'searchDepth', 'findImmediateWin',
  'threatLevel', 'countThreats', 'canWinNow', 'scoreFor', 'evaluateBoard', 'evaluateCell',
  'lineInfo', 'lineScore', 'getCandidateMoves', 'forcingMovesOf', 'resolveThreats',
  'findVcfWin', 'findVctWin', 'findDoubleThreat', 'findDoubleKill', 'findOpponentDoubleThreat',
  'pickVaried', 'pickTopN', 'bookMove', 'openingMove', 'comboBonus', 'threatSpaceBonus',
  'directionScore', 'initSearchTables', 'hashXor'];

const anchor = '  return {';
const at = src.lastIndexOf(anchor);
if (at < 0) { console.error('找不到返回对象'); process.exit(2); }

/* 把整个 IIFE 的返回值先接住，再在其上覆盖包装（避免重复键语法错误）。
 * 做法：把 `return { ... };` 改成 `const __api = { ... }; <wrap>; return __api;` */
const closeIdx = src.lastIndexOf('  };');
if (closeIdx < at) { console.error('找不到返回对象结尾'); process.exit(2); }
const wrapCode = NEED.map(n => `__api.${n} = publicFn(__api.${n});`).join('\n  ');
src = src.slice(0, at) + '  const __api = {' +
      src.slice(at + anchor.length, closeIdx) +
      '  };\n  ' + wrapCode + '\n  return __api;' +
      src.slice(closeIdx + 4);

try { new vm.Script(src, { filename: 'wrapped.js' }); }
catch (e) { console.error('语法错误: ' + e.message); process.exit(1); }

const sandbox = {
  module: { exports: {} }, console, performance: { now: () => Date.now() },
  Math, JSON, Set, Map, Int32Array, Uint8Array, Array, Object, Number, String,
  isNaN, parseInt, parseFloat, Infinity, NaN,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(src, sandbox, { filename: 'wrapped.js' }); }
catch (e) { console.error('执行失败: ' + e.message); process.exit(1); }
const A = sandbox.module.exports;

/* 用题库里的三个失败局面测试 */
const CASES = [
  { id: 'block-double-four-white', turn: 2, good: [[10, 7]], stones: { 1: [[10, 4], [10, 5], [10, 6], [8, 7], [9, 7]], 2: [[12, 12], [13, 13]] } },
  { id: 'corner-edge-three-black', turn: 1, good: [[0, 1], [0, 5]], stones: { 1: [[0, 2], [0, 3], [0, 4]], 2: [[5, 5], [6, 6]] } },
  { id: 'block-four-three-threat-white', turn: 2, good: [[10, 4], [10, 9], [7, 7]], stones: { 1: [[10, 5], [10, 6], [10, 7], [10, 8], [8, 7], [9, 7], [11, 7]], 2: [[12, 12], [13, 13]] } },
];

A.setBoardSize(19);
A.setMoveVariety(0);
let pass = 0;
for (const c of CASES) {
  const b = A.board;
  for (let r = 0; r < 19; r++) for (let cc = 0; cc < 19; cc++) b[r][cc] = 0;
  for (const [color, cells] of Object.entries(c.stones)) for (const [r, cc] of cells) b[r][cc] = Number(color);
  A.setColors(c.turn === 1 ? 2 : 1, c.turn);
  const mv = A.getBestMove('medium', c.turn);
  const ok = mv && c.good.some(([r, cc]) => r === mv[0] && cc === mv[1]);
  console.log(`  ${ok ? '✓' : '✗'} ${c.id.padEnd(30)} 落点 ${JSON.stringify(mv)}  期望 ${JSON.stringify(c.good)}`);
  if (ok) pass++;
}
console.log(`\n加了 publicFn 包装后：${pass}/${CASES.length} 通过`);
console.log(pass === CASES.length
  ? '→ 结论：改造只差“接口包装”这层接线，补上即可用'
  : '→ 结论：除包装外还有其它问题（增量维护逻辑本身不完整）');
