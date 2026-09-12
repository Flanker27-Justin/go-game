// 生成候选：加入“必胜距离”计分（mate distance）。
// 现状：minimax 命中必胜直接返回 WIN_SCORE，命中必败返回 -WIN_SCORE，
//       无论 3 步取胜还是 20 步取胜分数相同 → 该收不收、该拖不拖。
// 改动：返回 WIN_SCORE -（已走层数），使“越早取胜分越高”；负分同样处理，
//       使“越晚落败越好”。同时把根节点“已确认必杀”的判定改为 >= WIN_SCORE - 1000。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'outputs', 'engine', 'gomoku-ai.js');
const OUT = path.join(ROOT, 'work', 'archive', '_engine-mate.js');

let src = fs.readFileSync(SRC, 'utf8');
const misses = [];
function rep(from, to) {
  if (!src.includes(from)) { misses.push(from); return; }
  src = src.replace(from, to);
}

/* 1) 在 searchState 里记录根深度（用于换算“距离根几步”） */
rep('  searchState = { t0: performance.now(), budget: budgetMs };',
  '  searchState = { t0: performance.now(), budget: budgetMs, rootDepth: depthLimit > 0 ? Math.min(depthLimit, searchDepth()) : searchDepth() };');

/* 2) 必胜/必败分改为带距离 */
rep(`  // 任一方向存在一步成五 → 立即返回必胜/必败分，无需继续搜索
  if (findImmediateWin(me)) return WIN_SCORE;
  if (findImmediateWin(opp)) return -WIN_SCORE;`,
  `  // 任一方向存在一步成五 → 立即返回必胜/必败分，无需继续搜索。
  // 必胜距离（mate distance）：越早取胜分越高、越晚落败越好。
  // 距离用“根节点已走的层数”衡量（rootDepth - depth），两侧一致，
  // 因此 negamax 的符号约定不受影响。
  {
    const dist = searchState ? Math.max(0, searchState.rootDepth - depth) : 0;
    if (findImmediateWin(me)) return WIN_SCORE - dist;
    if (findImmediateWin(opp)) return -WIN_SCORE + dist;
  }`);

/* 3) 根节点“确认必杀即收手”的阈值同步放宽（因为现在返回值带距离偏移） */
rep('      if (v >= WIN_SCORE) return [r, c];',
  '      if (v >= WIN_SCORE - 1000) return [r, c];   // 带距离偏移后的“已确认必胜”阈值');

const problems = [];
if (misses.length) for (const m of misses) problems.push('未命中: ' + JSON.stringify(m.slice(0, 70)));
if (!src.includes('WIN_SCORE - dist')) problems.push('未注入 mate distance');
if (!src.includes('rootDepth')) problems.push('未注入 rootDepth');
try { new (require('vm').Script)(src, { filename: 'mate.js' }); } catch (e) { problems.push('语法错误: ' + e.message); }
if (problems.length) { console.log('!! 生成失败:'); for (const p of problems) console.log('  - ' + p); process.exit(1); }

fs.writeFileSync(OUT, src, 'utf8');
console.log('已生成候选: work/archive/_engine-mate.js（必胜距离）');

/* 冒烟测试：构造“3 步必胜”与“5 步必胜”两个局面，确认评分偏好更短者 */
const vm = require('vm');
function load(file) {
  const sb = { module: { exports: {} }, console, performance: { now: () => Date.now() }, Math, JSON, Set, Map, Int32Array, Array, Object, Number, String, isNaN, parseInt, parseFloat, Infinity, NaN };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
  const api = sb.module.exports;
  api.setMoveVariety(0); api.setBoardSize(19); api.setColors(2, 1);
  return api;
}
const base = load(SRC), mate = load(OUT);
function setup(A) {
  const b = A.board;
  for (let r = 0; r < 19; r++) for (let c = 0; c < 19; c++) b[r][c] = 0;
  /* 黑有活三：X X X _，落一端成活四 → 两步内必胜 */
  b[10][5] = 1; b[10][6] = 1; b[10][7] = 1;
  b[3][3] = 2; b[4][4] = 2;
}
for (const [name, A] of [['原版', base], ['mate', mate]]) {
  setup(A);
  const t0 = Date.now();
  const mv = A.getBestMove('hard', 1);
  console.log(`  ${name.padEnd(5)} hard 落点 ${JSON.stringify(mv)}  (${Date.now() - t0}ms)`);
}
